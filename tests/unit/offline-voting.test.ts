import assert from "node:assert/strict";
import test from "node:test";
import {
  queueOfflineVote,
  getPendingVotes,
  getAllQueuedVotes,
  getQueuedVote,
  updateQueuedVote,
  removeQueuedVote,
  clearOfflineQueue,
  type QueuedOfflineVote,
} from "@/offline/indexeddb";
import {
  encryptBallotOffline,
  decryptBallotOffline,
} from "@/offline/offline-encryption";
import {
  synchronizeQueuedVote,
  synchronizeAllPendingVotes,
} from "@/offline/sync";

test("Phase 13 [1]: Persistent offline storage - Queue and retrieve encrypted vote", async () => {
  await clearOfflineQueue();

  const queued = await encryptBallotOffline({
    electionId: "election-test-101",
    electionName: "Campus President Election",
    candidateId: "cand-aurora-99",
  });

  await queueOfflineVote(queued);

  const pending = await getPendingVotes();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, queued.id);
  assert.equal(pending[0].electionId, "election-test-101");
  assert.equal(pending[0].status, "QUEUED");
  assert.equal(pending[0].retryCount, 0);
});

test("Phase 13 [2]: Security - NO plaintext candidate choice or server secrets in storage", async () => {
  await clearOfflineQueue();

  const secretCandidateChoice = "candidate-top-secret-777";
  const queued = await encryptBallotOffline({
    electionId: "election-security-test",
    electionName: "Student Council Election",
    candidateId: secretCandidateChoice,
  });

  await queueOfflineVote(queued);

  const stored = await getQueuedVote(queued.id);
  assert.notEqual(stored, null);

  const serialized = JSON.stringify(stored);

  // Strict check: Candidate choice MUST NOT appear in storage
  assert.equal(serialized.includes(secretCandidateChoice), false);
  assert.equal(serialized.includes("candidate-top-secret"), false);

  // Strict check: No server secrets or private keys in storage
  assert.equal(serialized.includes("BALLOT_ENCRYPTION_KEY"), false);
  assert.equal(serialized.includes("KEY_ENCRYPTION_KEY"), false);
  assert.equal(serialized.includes("ETHEREUM_PRIVATE_KEY"), false);
  assert.equal(serialized.includes("DATABASE_URL"), false);
  assert.equal(serialized.includes("keyshare:"), false);
});

test("Phase 13 [3]: Refresh/restart recovery - Stored queue item survives and decrypts correctly", async () => {
  await clearOfflineQueue();

  const originalChoice = "cand-borealis-42";
  const queued = await encryptBallotOffline({
    electionId: "election-restart-test",
    electionName: "Annual General Election",
    candidateId: originalChoice,
  });

  await queueOfflineVote(queued);

  // Simulate recovery across page refresh or browser restart by retrieving directly from storage
  const recovered = await getQueuedVote(queued.id);
  assert.notEqual(recovered, null);
  assert.equal(recovered?.status, "QUEUED");

  // In-memory decryption at sync time must faithfully recover the original choice
  const recoveredChoice = await decryptBallotOffline(recovered!);
  assert.equal(recoveredChoice, originalChoice);
});

test("Phase 13 [4]: Tamper resistance - Tampered ciphertext or authTag is rejected", async () => {
  const queued = await encryptBallotOffline({
    electionId: "election-tamper-test",
    electionName: "Tamper Test Election",
    candidateId: "cand-legit-1",
  });

  // Tamper with ciphertext
  const tamperedCiphertext = {
    ...queued,
    encryptedBallot: queued.encryptedBallot.slice(0, -4) + "AAAA",
  };

  await assert.rejects(
    async () => {
      await decryptBallotOffline(tamperedCiphertext);
    },
    /tampered/i,
  );

  // Tamper with auth tag
  const tamperedTag = {
    ...queued,
    authTag: "AAAAAAAAAAAAAAAAAAAAAA",
  };

  await assert.rejects(
    async () => {
      await decryptBallotOffline(tamperedTag);
    },
    /tampered/i,
  );
});

test("Phase 13 [5]: Election binding - Queued ballot cannot be decrypted under different electionId", async () => {
  const queued = await encryptBallotOffline({
    electionId: "election-alpha-correct",
    electionName: "Alpha Election",
    candidateId: "cand-choice-1",
  });

  // Alter electionId
  const wrongElection = {
    ...queued,
    electionId: "election-beta-fake",
  };

  await assert.rejects(
    async () => {
      await decryptBallotOffline(wrongElection);
    },
    /tampering or election mismatch/i,
  );
});

test("Phase 13 [6]: Synchronization - Successful backend and blockchain confirmation", async () => {
  await clearOfflineQueue();

  const queued = await encryptBallotOffline({
    electionId: "election-sync-test",
    electionName: "Sync Election",
    candidateId: "cand-sync-1",
  });
  await queueOfflineVote(queued);

  // Mock fetch that simulates backend acceptance and Sepolia mining
  const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    assert.equal(body.candidateId, "cand-sync-1");
    assert.equal(body.offlineBuffered, true);

    return {
      ok: true,
      status: 201,
      json: async () => ({
        ok: true,
        receipt: {
          receiptId: "RCPT-OFFLINE-TEST-001",
          electionId: "election-sync-test",
          voteId: "vote-uuid-12345",
          txHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          blockNumber: 11820450,
          recordHash: "hash-offline-record-123",
          submittedAt: new Date().toISOString(),
          zkVerified: true,
        },
      }),
    };
  }) as unknown as typeof fetch;

  const result = await synchronizeQueuedVote(queued, { fetchImpl: mockFetch });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.status, "CONFIRMED");
    assert.equal(result.txHash.startsWith("0x"), true);
    assert.equal(result.blockNumber, 11820450);
  }

  // Verify storage state transitioned to CONFIRMED
  const stored = await getQueuedVote(queued.id);
  assert.equal(stored?.status, "CONFIRMED");
  assert.equal(stored?.receipt?.receiptId, "RCPT-OFFLINE-TEST-001");
  assert.equal(stored?.receipt?.txHash.startsWith("0x"), true);
});

test("Phase 13 [7]: Retry after network failure - Vote remains QUEUED with incremented retry count", async () => {
  await clearOfflineQueue();

  const queued = await encryptBallotOffline({
    electionId: "election-retry-test",
    electionName: "Retry Test Election",
    candidateId: "cand-retry-1",
  });
  await queueOfflineVote(queued);

  // Mock fetch that simulates network failure
  const mockFetch = (async () => {
    throw new TypeError("Failed to fetch: Network is down.");
  }) as unknown as typeof fetch;

  const result = await synchronizeQueuedVote(queued, { fetchImpl: mockFetch });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, "QUEUED");
    assert.equal(result.networkError, true);
  }

  const stored = await getQueuedVote(queued.id);
  assert.equal(stored?.status, "QUEUED");
  assert.equal(stored?.retryCount, 1);
  assert.notEqual(stored?.lastAttemptAt, undefined);
});

test("Phase 13 [8]: Duplicate synchronization protection - Replay attempt rejected (HTTP 409)", async () => {
  await clearOfflineQueue();

  const queued = await encryptBallotOffline({
    electionId: "election-dup-test",
    electionName: "Duplicate Test Election",
    candidateId: "cand-dup-1",
  });
  await queueOfflineVote(queued);

  // Mock fetch simulating 409 Conflict from server
  const mockFetch = (async () => ({
    ok: false,
    status: 409,
    json: async () => ({
      error: "You have already cast a ballot in this election.",
    }),
  })) as unknown as typeof fetch;

  const result = await synchronizeQueuedVote(queued, { fetchImpl: mockFetch });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, "FAILED");
    assert.equal(result.duplicate, true);
    assert.equal(result.error.includes("already cast"), true);
  }
});

test("Phase 13 [9]: Queue cleanup - Successfully removes item from storage", async () => {
  await clearOfflineQueue();

  const queued = await encryptBallotOffline({
    electionId: "election-cleanup-test",
    electionName: "Cleanup Election",
    candidateId: "cand-clean-1",
  });
  await queueOfflineVote(queued);

  let all = await getAllQueuedVotes();
  assert.equal(all.length, 1);

  await removeQueuedVote(queued.id);

  all = await getAllQueuedVotes();
  assert.equal(all.length, 0);
});
