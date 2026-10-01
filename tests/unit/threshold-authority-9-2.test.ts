import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  splitElectionSecret,
  reconstructSecretFromShares,
  reconstructAndValidateElectionKey,
  evaluateAuthorityThreshold,
} from "@/security/threshold";
import { generateElectionKey } from "@/security/election-keys";
import { encryptBallot, decryptBallot } from "@/security/encryption";
import { checkVoterElectionEligibility } from "@/backend/voting/eligibility";
import { isAdminRole } from "@/backend/auth/session";
import { UserRole } from "@prisma/client";

process.env.BALLOT_ENCRYPTION_KEY =
  process.env.BALLOT_ENCRYPTION_KEY || "test-ballot-encryption-key-with-32-chars";

test("Phase 9.2: 2-of-3 Threshold Matrix for Authority Shares", () => {
  const electionId = "election-phase92-test";
  const { rawKey: dek, keyCommitment } = generateElectionKey();

  // Split DEK into 3 Shamir shares with threshold 2
  const shares = splitElectionSecret(electionId, dek, 3, 2);
  assert.equal(shares.length, 3);

  const shareA = shares[0]; // Authority A (x = 1)
  const shareB = shares[1]; // Authority B (x = 2)
  const shareC = shares[2]; // Authority C (x = 3)

  // 1. Authority A only -> FAIL
  assert.throws(
    () => reconstructSecretFromShares([shareA], 2, electionId),
    /Insufficient authority key shares/,
  );
  assert.throws(
    () => reconstructAndValidateElectionKey({ electionId, keyCommitment, shares: [shareA], threshold: 2 }),
    /Insufficient authority key shares/,
  );

  // 2. Authority B only -> FAIL
  assert.throws(
    () => reconstructSecretFromShares([shareB], 2, electionId),
    /Insufficient authority key shares/,
  );
  assert.throws(
    () => reconstructAndValidateElectionKey({ electionId, keyCommitment, shares: [shareB], threshold: 2 }),
    /Insufficient authority key shares/,
  );

  // 3. Authority C only -> FAIL
  assert.throws(
    () => reconstructSecretFromShares([shareC], 2, electionId),
    /Insufficient authority key shares/,
  );
  assert.throws(
    () => reconstructAndValidateElectionKey({ electionId, keyCommitment, shares: [shareC], threshold: 2 }),
    /Insufficient authority key shares/,
  );

  // 4. A + B -> SUCCESS
  const recoveredAB = reconstructAndValidateElectionKey({
    electionId,
    keyCommitment,
    shares: [shareA, shareB],
    threshold: 2,
  });
  assert.equal(recoveredAB, dek);

  // 5. A + C -> SUCCESS
  const recoveredAC = reconstructAndValidateElectionKey({
    electionId,
    keyCommitment,
    shares: [shareA, shareC],
    threshold: 2,
  });
  assert.equal(recoveredAC, dek);

  // 6. B + C -> SUCCESS
  const recoveredBC = reconstructAndValidateElectionKey({
    electionId,
    keyCommitment,
    shares: [shareB, shareC],
    threshold: 2,
  });
  assert.equal(recoveredBC, dek);

  // 7. A + B + C (all 3 shares) -> SUCCESS
  const recoveredABC = reconstructAndValidateElectionKey({
    electionId,
    keyCommitment,
    shares: [shareA, shareB, shareC],
    threshold: 2,
  });
  assert.equal(recoveredABC, dek);

  // 8. Duplicate approval (A + A) -> FAIL / counts as one authority
  assert.throws(
    () => reconstructSecretFromShares([shareA, shareA], 2, electionId),
    /Insufficient authority key shares/,
  );
  const evalDup = evaluateAuthorityThreshold(
    [
      { authorityId: "auth-A", approved: true, keyShare: shareA },
      { authorityId: "auth-A", approved: true, keyShare: shareA },
    ],
    2,
    electionId,
  );
  assert.equal(evalDup.approvals, 1);
  assert.equal(evalDup.sharesSubmitted, 1);
  assert.equal(evalDup.canReconstructKey, false);

  // 9. Tampered share -> FAIL (commitment mismatch)
  const parts = shareB.split(":");
  const rawBytes = Buffer.from(parts[3], "base64url");
  rawBytes[0] ^= 0x55; // flip bits in the first byte to corrupt share
  const tamperedShare = `${parts[0]}:${parts[1]}:${parts[2]}:${rawBytes.toString("base64url")}`;

  assert.throws(
    () =>
      reconstructAndValidateElectionKey({
        electionId,
        keyCommitment,
        shares: [shareA, tamperedShare],
        threshold: 2,
      }),
    /Reconstructed key does not match election keyCommitment|Key share length mismatch|Invalid key share encoding/,
  );

  // 10. Wrong-election share -> FAIL
  const wrongElectionId = "other-election-xyz";
  const wrongElectionShares = splitElectionSecret(wrongElectionId, dek, 3, 2);
  assert.throws(
    () =>
      reconstructAndValidateElectionKey({
        electionId,
        keyCommitment,
        shares: [shareA, wrongElectionShares[1]],
        threshold: 2,
      }),
    /Wrong-election share rejected/,
  );
});

test("Phase 9.2: Ballot Decryption with Reconstructed DEK", () => {
  const electionId = "election-voting-threshold-test";
  const { rawKey: dek, keyCommitment } = generateElectionKey();
  const shares = splitElectionSecret(electionId, dek, 3, 2);

  const candidateId = "candidate-1";
  const validCandidateIds = ["candidate-1", "candidate-2"];
  const nonce = "ballot-test-nonce-92";

  // Encrypt ballot using the election DEK
  const ballot = encryptBallot({
    electionId,
    candidateId,
    validCandidateIds,
    nonce,
    encryptionKey: dek,
  });

  // Reconstruct DEK using Trustees B and C
  const reconstructedDek = reconstructAndValidateElectionKey({
    electionId,
    keyCommitment,
    shares: [shares[1], shares[2]],
    threshold: 2,
  });

  // Decrypt ballot using reconstructed DEK
  const decryptedCandidate = decryptBallot({
    electionId,
    ballot,
    encryptionKey: reconstructedDek,
  });

  assert.equal(decryptedCandidate, candidateId);
});

test("Phase 9.2: Role Boundaries and Access Restrictions", async () => {
  // 1. Voter cannot act as Authority
  const voterEligibility = await checkVoterElectionEligibility({
    userId: "authority-user-1",
    email: "authority@votechain.local",
    role: "AUTHORITY",
    emailVerified: true,
    electionId: "election-test",
  });
  assert.equal(voterEligibility.ok, false);
  assert.equal(voterEligibility.errorCode, "NOT_VOTER");

  // 2. Authority is not an Admin
  assert.equal(isAdminRole(UserRole.AUTHORITY), false);

  // 3. Voter is not an Admin
  assert.equal(isAdminRole(UserRole.VOTER), false);
});

test("Phase 9.2: Security Boundary - No secret shares or raw keys in client bundles", () => {
  const clientDir = join(process.cwd(), "src", "frontend", "components");
  const files = readdirSync(clientDir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));

  for (const file of files) {
    const content = readFileSync(join(clientDir, file), "utf8");
    assert.ok(
      !content.includes("splitElectionSecret"),
      `Client component ${file} imports splitElectionSecret!`,
    );
    assert.ok(
      !content.includes("reconstructSecretFromShares"),
      `Client component ${file} imports reconstructSecretFromShares!`,
    );
    assert.ok(
      !content.includes("reconstructAndValidateElectionKey"),
      `Client component ${file} imports reconstructAndValidateElectionKey!`,
    );
  }
});
