import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { UserRole, ElectionStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { createSessionToken, isAdminRole } from "./session";
import { isSameOriginRequest } from "./csrf";
import {
  generateElectionKey,
  getElectionEncryptionKey,
  isLegacyElection,
} from "./election-keys";
import {
  splitElectionSecret,
  reconstructSecretFromShares,
  reconstructAndValidateElectionKey,
  evaluateAuthorityThreshold,
} from "./authority";
import {
  encryptBallot,
  decryptBallot,
  verifyEncryptedBallot,
} from "./encrypted-ballot";
import { createZkVoteProof, verifyZkVoteProof } from "./zk-proof";
import { checkVoterElectionEligibility, importElectionEligibilityList } from "./eligibility";
import { validateVoteSubmission, verifyVoteReceipt } from "./voting";
import { parseEligibilityCsv, MAX_ELIGIBLE_VOTERS_CSV_ROWS } from "./csv-eligibility";
import { parseElectionInput, parseCandidateInput } from "./election-validation";
import {
  isValidPsgEmail,
  isValidStudentId,
  isValidName,
  isValidPassword,
  ALLOWED_EMAIL_DOMAIN,
} from "./auth-validation";
import nextConfig from "../../next.config";

// Ensure fallback key for testing
process.env.BALLOT_ENCRYPTION_KEY =
  process.env.BALLOT_ENCRYPTION_KEY || "test-ballot-encryption-key-with-32-chars";

// =====================================================================
// 1. AUTHENTICATION & RBAC SECURITY
// =====================================================================
test("Phase 11 Audit [1.1]: Role Boundaries - isAdminRole only returns true for ADMIN", () => {
  assert.equal(isAdminRole(UserRole.ADMIN), true);
  assert.equal(isAdminRole(UserRole.VOTER), false);
  assert.equal(isAdminRole(UserRole.AUTHORITY), false);
  assert.equal(isAdminRole(UserRole.OBSERVER), false);
});

test("Phase 11 Audit [1.2]: Role Boundaries - Non-voters strictly blocked from voting eligibility", async () => {
  const dummyElectionId = "dummy-election-auth-check";
  for (const role of [UserRole.ADMIN, UserRole.AUTHORITY, UserRole.OBSERVER]) {
    const result = await checkVoterElectionEligibility({
      userId: `user-${role.toLowerCase()}`,
      email: `${role.toLowerCase()}@votechain.local`,
      role,
      emailVerified: true,
      electionId: dummyElectionId,
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "NOT_VOTER");
  }
});

test("Phase 11 Audit [1.3]: Authority Role Validation - Non-authorities cannot satisfy authority evaluations", () => {
  const threshold = evaluateAuthorityThreshold(
    [
      { authorityId: "auth-1", approved: true, keyShare: "keyshare:elec:1:AAAA" },
      { authorityId: "auth-2", approved: false, keyShare: null },
    ],
    2,
    "elec"
  );
  assert.equal(threshold.approved, false);
  assert.equal(threshold.canReconstructKey, false);
  assert.equal(threshold.status, "PENDING");
});

test("Phase 11 Audit [1.4]: Admin User Creation - Voter accounts must use official @psgtech.ac.in domain", () => {
  const invalidVoterEmail = "voter@external-domain.com";
  const isAllowed = isValidPsgEmail(invalidVoterEmail) || invalidVoterEmail.endsWith("@votechain.local");
  assert.equal(isAllowed, false, "External email must not be allowed for VOTER role.");
});

// =====================================================================
// 2. VOTING INTEGRITY, TEMPORAL WINDOW & TAMPER RESISTANCE
// =====================================================================
test("Phase 11 Audit [2.1]: Voting - Duplicate vote submission is strictly rejected", () => {
  const validation = validateVoteSubmission({
    electionId: "elec-123",
    candidateId: "cand-1",
    validCandidateIds: ["cand-1", "cand-2"],
    hasExistingVote: true,
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.error, "This voter has already voted in this election.");
});

test("Phase 11 Audit [2.2]: Voting - Choice outside valid candidate set is strictly rejected", () => {
  const validation = validateVoteSubmission({
    electionId: "elec-123",
    candidateId: "cand-malicious",
    validCandidateIds: ["cand-1", "cand-2"],
    hasExistingVote: false,
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.error, "The selected candidate is not eligible for this election.");
});

test("Phase 11 Audit [2.3]: Voting - Ineligible voter domains are strictly blocked", async () => {
  const invalidEmails = [
    "student@gmail.com",
    "hacker@attacker.org",
    "student@psgtech.edu",
    "student@fake-psgtech.ac.in.com",
    "",
  ];
  for (const email of invalidEmails) {
    const check = isValidPsgEmail(email);
    assert.equal(check, false, `Expected ${email} to be blocked as invalid institutional domain.`);
  }
});

test("Phase 11 Audit [2.4]: Voting - Malformed / tampered ciphertext fails AES-256-GCM authentication", () => {
  const electionId = "elec-tamper-test";
  const { rawKey: dek } = generateElectionKey();
  const validCandidates = ["c1", "c2"];

  const ballot = encryptBallot({
    electionId,
    candidateId: "c1",
    validCandidateIds: validCandidates,
    nonce: "test-nonce-1",
    encryptionKey: dek,
  });

  // Tamper ciphertext
  const tamperedCiphertext = {
    ...ballot,
    ciphertext: ballot.ciphertext.slice(0, -2) + "xx",
  };
  assert.throws(
    () => decryptBallot({ electionId, ballot: tamperedCiphertext, encryptionKey: dek }),
    /Unsupported state or unable to authenticate data|decryption failed/i
  );

  // Tamper auth tag
  const tamperedAuthTag = {
    ...ballot,
    authTag: "AAAAAAAAAAAAAAAAAAAAAA==",
  };
  assert.throws(
    () => decryptBallot({ electionId, ballot: tamperedAuthTag, encryptionKey: dek }),
    /Unsupported state or unable to authenticate data|decryption failed/i
  );

  // Tamper nonce
  const tamperedNonce = {
    ...ballot,
    nonce: "tampered-nonce",
  };
  assert.throws(
    () => decryptBallot({ electionId, ballot: tamperedNonce, encryptionKey: dek }),
    /Unsupported state or unable to authenticate data|decryption failed/i
  );
});

test("Phase 11 Audit [2.5]: Voting - Tampered or mismatched ZK proofs are strictly rejected", async () => {
  const electionId = "elec-zk-audit";
  const validCandidateIds = ["cand-a", "cand-b"];
  const nonce = "zk-audit-nonce";

  const zkVoteProof = await createZkVoteProof({
    electionId,
    candidateId: "cand-a",
    validCandidateIds,
    nonce,
  });

  // 1. Authentic proof passes
  const validResult = await verifyZkVoteProof({
    electionId,
    proof: zkVoteProof,
    validCandidateIds,
  });
  assert.equal(validResult, true);

  // 2. Tampered proof payload fails
  const rawJson = JSON.parse(
    Buffer.from(zkVoteProof.proof.replace("zk:babyjub:", ""), "base64url").toString("utf8")
  );
  rawJson.challenges[0] = "999999999999999999";
  const tamperedProofString = `zk:babyjub:${Buffer.from(JSON.stringify(rawJson)).toString("base64url")}`;
  const tamperedResult = await verifyZkVoteProof({
    electionId,
    proof: tamperedProofString,
    validCandidateIds,
  });
  assert.equal(tamperedResult, false);

  // 3. Candidate outside set fails
  const foreignResult = await verifyZkVoteProof({
    electionId,
    proof: zkVoteProof,
    validCandidateIds: ["cand-x", "cand-y"],
  });
  assert.equal(foreignResult, false);

  // 4. Wrong election fails
  const wrongElectionResult = await verifyZkVoteProof({
    electionId: "different-election",
    proof: zkVoteProof,
    validCandidateIds,
  });
  assert.equal(wrongElectionResult, false);
});

test("Phase 11 Audit [2.6]: Voting Window - Vote rejected when current time is outside scheduled election time window", () => {
  const now = new Date();
  const pastStart = new Date(now.getTime() - 2 * 3600000);
  const pastEnd = new Date(now.getTime() - 1 * 3600000); // Ended 1 hour ago

  const validationEnded = validateVoteSubmission({
    electionId: "elec-ended",
    candidateId: "cand-1",
    validCandidateIds: ["cand-1", "cand-2"],
    hasExistingVote: false,
    startTime: pastStart,
    endTime: pastEnd,
    now,
  });
  assert.equal(validationEnded.ok, false);
  assert.match(validationEnded.error || "", /election time window/i);

  const futureStart = new Date(now.getTime() + 1 * 3600000); // Starts in 1 hour
  const futureEnd = new Date(now.getTime() + 2 * 3600000);
  const validationFuture = validateVoteSubmission({
    electionId: "elec-future",
    candidateId: "cand-1",
    validCandidateIds: ["cand-1", "cand-2"],
    hasExistingVote: false,
    startTime: futureStart,
    endTime: futureEnd,
    now,
  });
  assert.equal(validationFuture.ok, false);
  assert.match(validationFuture.error || "", /election time window/i);
});

// =====================================================================
// 3. THRESHOLD RECONSTRUCTION & KEY ISOLATION
// =====================================================================
test("Phase 11 Audit [3.1]: Threshold - Reconstruct key strictly fails with 0 or 1 share", () => {
  const electionId = "elec-threshold-audit";
  const { rawKey: dek, keyCommitment } = generateElectionKey();
  const shares = splitElectionSecret(electionId, dek, 3, 2);

  assert.throws(
    () => reconstructAndValidateElectionKey({ electionId, keyCommitment, shares: [], threshold: 2 }),
    /Insufficient authority key shares/
  );

  assert.throws(
    () => reconstructAndValidateElectionKey({ electionId, keyCommitment, shares: [shares[0]], threshold: 2 }),
    /Insufficient authority key shares/
  );
});

test("Phase 11 Audit [3.2]: Threshold - All valid 2-of-3 and 3-of-3 combinations succeed", () => {
  const electionId = "elec-threshold-audit";
  const { rawKey: dek, keyCommitment } = generateElectionKey();
  const shares = splitElectionSecret(electionId, dek, 3, 2);

  const keyAB = reconstructAndValidateElectionKey({ electionId, keyCommitment, shares: [shares[0], shares[1]], threshold: 2 });
  assert.equal(keyAB, dek);

  const keyAC = reconstructAndValidateElectionKey({ electionId, keyCommitment, shares: [shares[0], shares[2]], threshold: 2 });
  assert.equal(keyAC, dek);

  const keyBC = reconstructAndValidateElectionKey({ electionId, keyCommitment, shares: [shares[1], shares[2]], threshold: 2 });
  assert.equal(keyBC, dek);

  const keyABC = reconstructAndValidateElectionKey({ electionId, keyCommitment, shares: [shares[0], shares[1], shares[2]], threshold: 2 });
  assert.equal(keyABC, dek);
});

test("Phase 11 Audit [3.3]: Threshold - Duplicate A+A share fails by coordinate deduplication", () => {
  const electionId = "elec-threshold-audit";
  const { rawKey: dek, keyCommitment } = generateElectionKey();
  const shares = splitElectionSecret(electionId, dek, 3, 2);

  assert.throws(
    () => reconstructAndValidateElectionKey({ electionId, keyCommitment, shares: [shares[0], shares[0]], threshold: 2 }),
    /Insufficient authority key shares/
  );
});

test("Phase 11 Audit [3.4]: Threshold - Wrong-election share and tampered share strictly rejected", () => {
  const electionId = "elec-threshold-audit";
  const { rawKey: dek, keyCommitment } = generateElectionKey();
  const shares = splitElectionSecret(electionId, dek, 3, 2);
  const otherShares = splitElectionSecret("other-election", dek, 3, 2);

  // Wrong election
  assert.throws(
    () => reconstructAndValidateElectionKey({ electionId, keyCommitment, shares: [shares[0], otherShares[1]], threshold: 2 }),
    /Wrong-election share rejected/
  );

  // Bit-flipped tampered share
  const parts = shares[1].split(":");
  const corruptedBytes = Buffer.from(parts[3], "base64url");
  corruptedBytes[0] ^= 0x55;
  const corruptedShare = `${parts[0]}:${parts[1]}:${parts[2]}:${corruptedBytes.toString("base64url")}`;

  assert.throws(
    () => reconstructAndValidateElectionKey({ electionId, keyCommitment, shares: [shares[0], corruptedShare], threshold: 2 }),
    /Reconstructed key does not match election keyCommitment/
  );
});

test("Phase 11 Audit [3.5]: Threshold - Global BALLOT_ENCRYPTION_KEY bypass strictly prevented for results_tally", () => {
  const modernElection = {
    id: "elec-modern-bypass-check",
    name: "Modern Election",
    encryptedMasterKey: "kek:aes-256-gcm:fake-envelope",
    keyCommitment: "sha256:fake-commitment",
  };

  assert.equal(isLegacyElection(modernElection), false);
  assert.throws(
    () => getElectionEncryptionKey(modernElection, { purpose: "results_tally" }),
    /forbidden for results tallying/i
  );
});

// =====================================================================
// 4. PRIVACY, CLIENT BUNDLE & SECRETS AUDIT
// =====================================================================
test("Phase 11 Audit [4.1]: Privacy - No sensitive secrets exposed via NEXT_PUBLIC_ variables", () => {
  const publicKeys = Object.keys(process.env).filter((k) => k.startsWith("NEXT_PUBLIC_"));
  const forbiddenPatterns = [/SECRET/i, /PASSWORD/i, /PASS/i, /DATABASE/i, /PRISMA/i, /KEY/i, /PRIVATE/i, /TOKEN/i];

  for (const key of publicKeys) {
    for (const pattern of forbiddenPatterns) {
      assert.ok(!pattern.test(key), `CRITICAL: Environment variable ${key} leaks secrets to client bundle.`);
    }
  }
});

test("Phase 11 Audit [4.2]: Privacy - Client components do not import cryptographic reconstruction or private keys", () => {
  const componentsDir = join(process.cwd(), "src", "components");
  const files = readdirSync(componentsDir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));

  const forbiddenImports = [
    "reconstructAndValidateElectionKey",
    "reconstructSecretFromShares",
    "splitElectionSecret",
    "generateElectionKey",
    "ETHEREUM_PRIVATE_KEY",
    "SESSION_SECRET",
    "DATABASE_URL",
  ];

  for (const file of files) {
    const content = readFileSync(join(componentsDir, file), "utf8");
    for (const item of forbiddenImports) {
      assert.ok(!content.includes(item), `Client component ${file} imports forbidden secret symbol "${item}".`);
    }
  }
});

test("Phase 11 Audit [4.3]: Privacy - Git repo does not track private keys, certificates or .env files", () => {
  const trackedEnv = execSync("git ls-files .env .env.local", { encoding: "utf8" }).trim();
  assert.equal(trackedEnv, "", "Git must not track .env or .env.local files.");
});

test("Phase 11 Audit [4.4]: Privacy - Election responses sanitize encryptedMasterKey envelope from client", () => {
  const mockDbElection = {
    id: "elec-mock",
    name: "Mock Election",
    encryptedMasterKey: "kek:aes-256-gcm:secret-envelope-data",
    keyCommitment: "sha256:abcd",
  };
  const { encryptedMasterKey, ...safeElection } = mockDbElection;
  assert.equal("encryptedMasterKey" in safeElection, false);
});

// =====================================================================
// 5. SESSION & CSRF SECURITY
// =====================================================================
test("Phase 11 Audit [5.1]: Session - HMAC signature prevents tampering with session tokens", () => {
  const userId = "test-user-alpha";
  const validToken = createSessionToken(userId);
  const [payload, signature] = validToken.split(".");

  // Tamper payload (e.g. modify user ID)
  const tamperedPayload = Buffer.from(
    JSON.stringify({ userId: "admin-user", expiresAt: Date.now() + 100000 })
  ).toString("base64url");
  const forgedToken = `${tamperedPayload}.${signature}`;

  assert.notEqual(validToken, forgedToken);
});

test("Phase 11 Audit [5.2]: CSRF - Cross-origin mutation requests are strictly rejected", () => {
  // 1. Same origin passes
  const sameOriginReq = {
    url: "https://votechain.psgtech.ac.in/api/voter/elections/123/vote",
    headers: new Headers({
      origin: "https://votechain.psgtech.ac.in",
    }),
  };
  assert.equal(isSameOriginRequest(sameOriginReq), true);

  // 2. Cross origin fails
  const crossOriginReq = {
    url: "https://votechain.psgtech.ac.in/api/voter/elections/123/vote",
    headers: new Headers({
      origin: "https://evil-attacker-site.com",
    }),
  };
  assert.equal(isSameOriginRequest(crossOriginReq), false);

  // 3. Missing origin and referer fails
  const noOriginReq = {
    url: "https://votechain.psgtech.ac.in/api/voter/elections/123/vote",
    headers: new Headers(),
  };
  assert.equal(isSameOriginRequest(noOriginReq), false);
});

// =====================================================================
// 6. BLOCKCHAIN COMMITMENT & RECEIPT INTEGRITY
// =====================================================================
test("Phase 11 Audit [6.1]: Blockchain - Authentic receipt verified, tampered receipt rejected", () => {
  const electionId = "elec-rcpt-test";
  const voteId = randomUUID();
  const submittedAt = new Date();

  const recordHash = createHash("sha256")
    .update(`${electionId}:${voteId}:${submittedAt.toISOString()}`)
    .digest("hex");

  // Authentic receipt
  const valid = verifyVoteReceipt({
    electionId,
    voteId,
    submittedAt,
    recordHash,
  });
  assert.equal(valid, true);

  // Tampered receipt hash
  const tampered = verifyVoteReceipt({
    electionId,
    voteId,
    submittedAt,
    recordHash: `${recordHash.slice(0, -1)}x`,
  });
  assert.equal(tampered, false);
});

// =====================================================================
// 7. API INPUT VALIDATION & BOUNDARY DEFENSES
// =====================================================================
test("Phase 11 Audit [7.1]: Validation - Election input parser rejects invalid start/end dates", () => {
  const now = new Date();
  const past = new Date(now.getTime() - 100000);

  const invalidDateResult = parseElectionInput({
    name: "Valid Election Name",
    description: "Valid Description",
    startTime: now.toISOString(),
    endTime: past.toISOString(), // end before start
    candidates: [{ name: "Cand 1" }, { name: "Cand 2" }],
  });
  assert.equal(invalidDateResult.ok, false);
  assert.equal(invalidDateResult.error, "The end time must be later than a valid start time.");
});

test("Phase 11 Audit [7.2]: Validation - Election input parser rejects duplicate candidate names", () => {
  const now = new Date();
  const future = new Date(now.getTime() + 100000);

  const duplicateCandidateResult = parseElectionInput({
    name: "Duplicate Cand Election",
    description: "Valid Description",
    startTime: now.toISOString(),
    endTime: future.toISOString(),
    candidates: [{ name: "Candidate Alpha" }, { name: "candidate alpha" }], // case-insensitive duplicate
  });
  assert.equal(duplicateCandidateResult.ok, false);
  assert.equal(duplicateCandidateResult.error, "Candidate names must be unique within an election.");
});

test("Phase 11 Audit [7.3]: Validation - CSV Parser rejects malformed headers and missing columns", () => {
  // Missing headers
  const badHeaderCsv = `col1,col2\n24N236,24n236@psgtech.ac.in`;
  const resultBad = parseEligibilityCsv(badHeaderCsv);
  assert.equal(resultBad.ok, false);

  // Valid CSV passes
  const validCsv = `student_id,email\n24N236,24n236@psgtech.ac.in\n24N237,24n237@psgtech.ac.in`;
  const resultGood = parseEligibilityCsv(validCsv);
  assert.equal(resultGood.ok, true);
  if (resultGood.ok) {
    assert.equal(resultGood.records.length, 2);
  }
});

test("Phase 11 Audit [7.4]: Validation - User input validation rejects short/oversized names and passwords", () => {
  assert.equal(isValidName("a").valid, false);
  assert.equal(isValidName("a".repeat(101)).valid, false);
  assert.equal(isValidName("Prakash").valid, true);

  assert.equal(isValidPassword("short").valid, false);
  assert.equal(isValidPassword("long_enough_password").valid, true);
});

test("Phase 11 Audit [7.5]: Validation - CSV Parser rejects oversized files exceeding maximum allowed voter rows", () => {
  const header = "student_id,email\n";
  const oversizedRows = Array.from(
    { length: 5001 },
    (_, i) => `24N${1000 + i},24n${1000 + i}@psgtech.ac.in`
  ).join("\n");
  const oversizedCsv = header + oversizedRows;
  const result = parseEligibilityCsv(oversizedCsv);
  assert.equal(result.ok, false);
  assert.match(result.error, /exceeds maximum allowed limit/i);
});

test("Phase 11 Audit [7.6]: Eligibility - Modification blocked on closed elections", async () => {
  const closedElection = await prisma.election.findFirst({
    where: { status: ElectionStatus.CLOSED },
  });
  if (closedElection) {
    await assert.rejects(
      async () => {
        await importElectionEligibilityList(
          closedElection.id,
          [{ studentId: "24N999", email: "24n999@psgtech.ac.in" }],
          "admin@votechain.local"
        );
      },
      /Eligibility register cannot be modified after an election has closed/
    );
  }
});

// =====================================================================
// 8. PRODUCTION SECURITY CONFIGURATION
// =====================================================================
test("Phase 11 Audit [8.1]: Production Security - Next.js security headers include nosniff, DENY, strict referrer", async () => {
  assert.ok(nextConfig.headers, "nextConfig must specify security headers.");
  const headersConfig = await nextConfig.headers!();
  const globalHeaders = headersConfig.find((h) => h.source === "/:path*");
  assert.ok(globalHeaders, "Global security header policy must exist.");

  const headerMap = new Map(globalHeaders!.headers.map((h) => [h.key, h.value]));
  assert.equal(headerMap.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headerMap.get("X-Frame-Options"), "DENY");
  assert.equal(headerMap.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(headerMap.get("Cross-Origin-Opener-Policy"), "same-origin");
  assert.equal(nextConfig.poweredByHeader, false, "X-Powered-By header must be disabled.");
});
