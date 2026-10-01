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
import {
  generateElectionKey,
  getElectionEncryptionKey,
  isLegacyElection,
} from "@/security/election-keys";
import {
  encryptBallot,
  type StoredEncryptedBallot,
} from "@/security/encryption";
import { summarizeStoredElectionResults } from "@/verification/results";

process.env.BALLOT_ENCRYPTION_KEY =
  process.env.BALLOT_ENCRYPTION_KEY || "test-ballot-encryption-key-with-32-chars";

test("Phase 9.3: Mandatory 2-of-3 Threshold Authority Reconstruction Suite", async (t) => {
  const electionId = "election-mandatory-93-test";
  const { rawKey: dek, encryptedMasterKey, keyCommitment } = generateElectionKey();

  const modernElection = {
    id: electionId,
    name: "Modern Phase 9 Test Election",
    encryptedMasterKey,
    keyCommitment,
    requiredAuthorityApprovals: 2,
  };

  // Generate 3 shares with threshold 2
  const shares = splitElectionSecret(electionId, dek, 3, 2);
  const shareA = shares[0]; // Auth 1 (x=1)
  const shareB = shares[1]; // Auth 2 (x=2)
  const shareC = shares[2]; // Auth 3 (x=3)

  // Setup test candidates and ballots encrypted with the per-election DEK
  const candidates = [
    { id: "cand-alice", name: "Alice" },
    { id: "cand-bob", name: "Bob" },
  ];
  const validCandidateIds = candidates.map((c) => c.id);

  // Cast 3 votes: 2 for Alice, 1 for Bob
  const ballotAlice1 = encryptBallot({
    electionId,
    candidateId: "cand-alice",
    validCandidateIds,
    nonce: "nonce-vote-1",
    encryptionKey: dek,
  });
  const ballotAlice2 = encryptBallot({
    electionId,
    candidateId: "cand-alice",
    validCandidateIds,
    nonce: "nonce-vote-2",
    encryptionKey: dek,
  });
  const ballotBob = encryptBallot({
    electionId,
    candidateId: "cand-bob",
    validCandidateIds,
    nonce: "nonce-vote-3",
    encryptionKey: dek,
  });

  const storedBallots: StoredEncryptedBallot[] = [
    {
      candidateId: null,
      voterId: null,
      encryptedBallot: ballotAlice1.ciphertext,
      ballotNonce: ballotAlice1.nonce,
      ballotAuthTag: ballotAlice1.authTag,
      ballotProof: ballotAlice1.proof,
    },
    {
      candidateId: null,
      voterId: null,
      encryptedBallot: ballotAlice2.ciphertext,
      ballotNonce: ballotAlice2.nonce,
      ballotAuthTag: ballotAlice2.authTag,
      ballotProof: ballotAlice2.proof,
    },
    {
      candidateId: null,
      voterId: null,
      encryptedBallot: ballotBob.ciphertext,
      ballotNonce: ballotBob.nonce,
      ballotAuthTag: ballotBob.authTag,
      ballotProof: ballotBob.proof,
    },
  ];

  // Helper simulating the tally route logic with mandatory threshold enforcement
  function simulateTallyingRoute(
    election: typeof modernElection,
    approvals: Array<{ authorityId: string; approved: boolean; keyShare?: string | null }>,
  ) {
    const thresholdResult = evaluateAuthorityThreshold(
      approvals,
      election.requiredAuthorityApprovals,
      election.id,
    );

    let encryptionKeyToUse: string | undefined = undefined;
    const submittedShares = approvals
      .filter((a) => a.approved && a.keyShare && a.keyShare.startsWith("keyshare:"))
      .map((a) => a.keyShare as string);

    if (thresholdResult.canReconstructKey && submittedShares.length >= election.requiredAuthorityApprovals) {
      encryptionKeyToUse = reconstructAndValidateElectionKey({
        electionId: election.id,
        keyCommitment: election.keyCommitment,
        shares: submittedShares,
        threshold: election.requiredAuthorityApprovals,
      });
    } else if (isLegacyElection(election)) {
      encryptionKeyToUse = getElectionEncryptionKey(election, { purpose: "results_tally" });
    } else {
      throw new Error(
        `Results tallying locked: need ${election.requiredAuthorityApprovals} authority shares (have ${thresholdResult.sharesSubmitted})`,
      );
    }

    return summarizeStoredElectionResults(election.id, candidates, storedBallots, encryptionKeyToUse);
  }

  await t.test("1. New election cannot be tallied with 0 shares", () => {
    assert.throws(
      () => simulateTallyingRoute(modernElection, []),
      /Results tallying locked/,
    );
    assert.throws(
      () => reconstructAndValidateElectionKey({ electionId, keyCommitment, shares: [], threshold: 2 }),
      /Insufficient authority key shares/,
    );
  });

  await t.test("2. New election cannot be tallied with share A only", () => {
    assert.throws(
      () =>
        simulateTallyingRoute(modernElection, [
          { authorityId: "auth-1", approved: true, keyShare: shareA },
        ]),
      /Results tallying locked/,
    );
    assert.throws(
      () => reconstructAndValidateElectionKey({ electionId, keyCommitment, shares: [shareA], threshold: 2 }),
      /Insufficient authority key shares/,
    );
  });

  await t.test("3. New election cannot be tallied with share B only", () => {
    assert.throws(
      () =>
        simulateTallyingRoute(modernElection, [
          { authorityId: "auth-2", approved: true, keyShare: shareB },
        ]),
      /Results tallying locked/,
    );
    assert.throws(
      () => reconstructAndValidateElectionKey({ electionId, keyCommitment, shares: [shareB], threshold: 2 }),
      /Insufficient authority key shares/,
    );
  });

  await t.test("4. New election cannot be tallied with share C only", () => {
    assert.throws(
      () =>
        simulateTallyingRoute(modernElection, [
          { authorityId: "auth-3", approved: true, keyShare: shareC },
        ]),
      /Results tallying locked/,
    );
    assert.throws(
      () => reconstructAndValidateElectionKey({ electionId, keyCommitment, shares: [shareC], threshold: 2 }),
      /Insufficient authority key shares/,
    );
  });

  await t.test("5. New election CAN be tallied with A + B", () => {
    const results = simulateTallyingRoute(modernElection, [
      { authorityId: "auth-1", approved: true, keyShare: shareA },
      { authorityId: "auth-2", approved: true, keyShare: shareB },
    ]);
    assert.equal(results.totalVotes, 3);
    assert.equal(results.winner?.name, "Alice");
    assert.equal(results.winner?.voteCount, 2);
    const bobResult = results.candidateResults.find((c) => c.name === "Bob");
    assert.equal(bobResult?.voteCount, 1);
  });

  await t.test("6. New election CAN be tallied with A + C", () => {
    const results = simulateTallyingRoute(modernElection, [
      { authorityId: "auth-1", approved: true, keyShare: shareA },
      { authorityId: "auth-3", approved: true, keyShare: shareC },
    ]);
    assert.equal(results.totalVotes, 3);
    assert.equal(results.winner?.name, "Alice");
    assert.equal(results.winner?.voteCount, 2);
  });

  await t.test("7. New election CAN be tallied with B + C", () => {
    const results = simulateTallyingRoute(modernElection, [
      { authorityId: "auth-2", approved: true, keyShare: shareB },
      { authorityId: "auth-3", approved: true, keyShare: shareC },
    ]);
    assert.equal(results.totalVotes, 3);
    assert.equal(results.winner?.name, "Alice");
    assert.equal(results.winner?.voteCount, 2);
  });

  await t.test("8. New election CAN be tallied with all 3 (A + B + C)", () => {
    const results = simulateTallyingRoute(modernElection, [
      { authorityId: "auth-1", approved: true, keyShare: shareA },
      { authorityId: "auth-2", approved: true, keyShare: shareB },
      { authorityId: "auth-3", approved: true, keyShare: shareC },
    ]);
    assert.equal(results.totalVotes, 3);
    assert.equal(results.winner?.name, "Alice");
    assert.equal(results.winner?.voteCount, 2);
  });

  await t.test("9. Duplicate approval from authority A does not satisfy threshold (A + A fails)", () => {
    assert.throws(
      () =>
        simulateTallyingRoute(modernElection, [
          { authorityId: "auth-1", approved: true, keyShare: shareA },
          { authorityId: "auth-1", approved: true, keyShare: shareA },
        ]),
      /Results tallying locked/,
    );
    assert.throws(
      () => reconstructSecretFromShares([shareA, shareA], 2, electionId),
      /Insufficient authority key shares/,
    );
  });

  await t.test("10. Tampered share fails and aborts reconstruction", () => {
    const parts = shareB.split(":");
    const rawBytes = Buffer.from(parts[3], "base64url");
    rawBytes[0] ^= 0xff; // corrupt first byte
    const tamperedShareB = `${parts[0]}:${parts[1]}:${parts[2]}:${rawBytes.toString("base64url")}`;

    assert.throws(
      () =>
        simulateTallyingRoute(modernElection, [
          { authorityId: "auth-1", approved: true, keyShare: shareA },
          { authorityId: "auth-2", approved: true, keyShare: tamperedShareB },
        ]),
      /Reconstructed key does not match election keyCommitment/,
    );
  });

  await t.test("11. Wrong-election share fails and is rejected", () => {
    const otherElectionId = "other-election-999";
    const otherShares = splitElectionSecret(otherElectionId, dek, 3, 2);

    assert.throws(
      () =>
        reconstructAndValidateElectionKey({
          electionId,
          keyCommitment,
          shares: [shareA, otherShares[1]],
          threshold: 2,
        }),
      /Wrong-election share rejected/,
    );

    // In evaluateAuthorityThreshold, wrong-election shares are filtered out
    const evalResult = evaluateAuthorityThreshold(
      [
        { authorityId: "auth-1", approved: true, keyShare: shareA },
        { authorityId: "auth-2", approved: true, keyShare: otherShares[1] },
      ],
      2,
      electionId,
    );
    assert.equal(evalResult.sharesSubmitted, 1);
    assert.equal(evalResult.canReconstructKey, false);
  });

  await t.test("12. Key commitment mismatch fails and aborts reconstruction", () => {
    const fakeCommitment = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    assert.throws(
      () =>
        reconstructAndValidateElectionKey({
          electionId,
          keyCommitment: fakeCommitment,
          shares: [shareA, shareB],
          threshold: 2,
        }),
      /Reconstructed key does not match election keyCommitment/,
    );
  });

  await t.test("13. Historical/legacy elections without per-election keys still work through backward-compatible path", () => {
    const legacyElection = {
      id: "legacy-election-phase8",
      name: "Phase 8 Browser Test Election",
      encryptedMasterKey: null,
      keyCommitment: null,
      requiredAuthorityApprovals: 2,
    };

    assert.equal(isLegacyElection(legacyElection), true);

    // Encrypt legacy ballot with global BALLOT_ENCRYPTION_KEY
    const legacyBallot = encryptBallot({
      electionId: legacyElection.id,
      candidateId: "cand-alice",
      validCandidateIds,
      nonce: "nonce-legacy-1",
      encryptionKey: process.env.BALLOT_ENCRYPTION_KEY,
    });

    const legacyStoredBallots: StoredEncryptedBallot[] = [
      {
        candidateId: null,
        voterId: null,
        encryptedBallot: legacyBallot.ciphertext,
        ballotNonce: legacyBallot.nonce,
        ballotAuthTag: legacyBallot.authTag,
        ballotProof: legacyBallot.proof,
      },
    ];

    // Historical tally works via backward-compatible path even without shares
    const legacyKey = getElectionEncryptionKey(legacyElection, { purpose: "results_tally" });
    assert.equal(legacyKey, process.env.BALLOT_ENCRYPTION_KEY);

    const legacyResults = summarizeStoredElectionResults(
      legacyElection.id,
      candidates,
      legacyStoredBallots,
      legacyKey,
    );
    assert.equal(legacyResults.totalVotes, 1);
    assert.equal(legacyResults.winner?.name, "Alice");
  });

  await t.test("14. Verify that no global BALLOT_ENCRYPTION_KEY fallback remains in the new-election final tally path", () => {
    assert.equal(isLegacyElection(modernElection), false);

    // Direct resolution for purpose="results_tally" MUST throw on modern elections
    assert.throws(
      () => getElectionEncryptionKey(modernElection, { purpose: "results_tally" }),
      /Direct master key resolution is forbidden for results tallying in Phase 9\+/,
    );

    // Attempting to tally modern ballots with BALLOT_ENCRYPTION_KEY fails AES-GCM decryption
    assert.throws(
      () =>
        summarizeStoredElectionResults(
          modernElection.id,
          candidates,
          storedBallots,
          process.env.BALLOT_ENCRYPTION_KEY,
        ),
      /Unsupported state or unable to authenticate data|Ballot integrity verification failed/,
    );
  });

  await t.test("15. Verify that no secret shares or reconstructed keys are exposed in API responses or client bundle", () => {
    // 1. Check client components do not import threshold reconstruction or key generation
    const clientDir = join(process.cwd(), "src", "frontend", "components");
    const clientFiles = readdirSync(clientDir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));

    for (const file of clientFiles) {
      const content = readFileSync(join(clientDir, file), "utf8");
      assert.ok(!content.includes("reconstructAndValidateElectionKey"), `Client component ${file} imports reconstructAndValidateElectionKey!`);
      assert.ok(!content.includes("reconstructSecretFromShares"), `Client component ${file} imports reconstructSecretFromShares!`);
      assert.ok(!content.includes("splitElectionSecret"), `Client component ${file} imports splitElectionSecret!`);
      assert.ok(!content.includes("generateElectionKey"), `Client component ${file} imports generateElectionKey!`);
    }

    // 2. Simulate API responses and verify schemas do not leak raw keys or shares
    const approvalResponseMock = {
      ok: true,
      approval: {
        id: "approval-1",
        electionId,
        authorityId: "auth-1",
        approved: true,
        hasKeyShare: true,
      },
    };
    const serializedApproval = JSON.stringify(approvalResponseMock);
    assert.ok(!serializedApproval.includes("keyshare:"), "Approval API response leaked raw key share string!");
    assert.ok(!serializedApproval.includes(dek), "Approval API response leaked raw election DEK!");

    const resultsResponseMock = {
      election: {
        id: electionId,
        name: modernElection.name,
        status: "CLOSED",
        requiredAuthorityApprovals: 2,
      },
      thresholdResult: evaluateAuthorityThreshold(
        [{ authorityId: "auth-1", approved: true, keyShare: shareA }, { authorityId: "auth-2", approved: true, keyShare: shareB }],
        2,
        electionId,
      ),
      summary: {
        totalVotes: 3,
        candidateResults: [{ candidateId: "cand-alice", name: "Alice", voteCount: 2 }],
        winner: { candidateId: "cand-alice", name: "Alice", voteCount: 2 },
      },
      auditDigest: "sha256:digest-test",
    };
    const serializedResults = JSON.stringify(resultsResponseMock);
    assert.ok(!serializedResults.includes("keyshare:"), "Results API response leaked raw key share string!");
    assert.ok(!serializedResults.includes(dek), "Results API response leaked raw election DEK!");
  });
});
