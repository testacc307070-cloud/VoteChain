import assert from "node:assert/strict";
import test from "node:test";

import { createVoteReceipt, validateVoteSubmission, verifyVoteReceipt } from "@/backend/voting/voting";

test("accepts a valid vote submission for an eligible voter", () => {
  const result = validateVoteSubmission({
    electionId: "election-123",
    candidateId: "cand-2",
    validCandidateIds: ["cand-1", "cand-2", "cand-3"],
    hasExistingVote: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.error, undefined);
});

test("rejects invalid candidate choices and duplicate votes", () => {
  const invalidCandidate = validateVoteSubmission({
    electionId: "election-123",
    candidateId: "cand-9",
    validCandidateIds: ["cand-1", "cand-2"],
    hasExistingVote: false,
  });

  const duplicateVote = validateVoteSubmission({
    electionId: "election-123",
    candidateId: "cand-2",
    validCandidateIds: ["cand-1", "cand-2"],
    hasExistingVote: true,
  });

  assert.equal(invalidCandidate.ok, false);
  assert.equal(invalidCandidate.ok ? "" : invalidCandidate.error.includes("eligible"), true);
  assert.equal(duplicateVote.ok, false);
  assert.equal(duplicateVote.ok ? "" : duplicateVote.error.includes("already voted"), true);
});

test("creates a verifiable receipt that does not depend on the selected choice", () => {
  const receipt = createVoteReceipt({
    electionId: "election-123",
    voteId: "vote-456",
    submittedAt: new Date("2026-09-26T12:00:00.000Z"),
  });

  assert.equal(receipt.receiptId.startsWith("RCPT-"), true);
  assert.equal(receipt.electionId, "election-123");
  assert.equal(receipt.recordHash.length >= 24, true);
  assert.equal(receipt.txHash.startsWith("0x"), true);
  assert.equal(receipt.blockNumber > 0, true);
  assert.equal(JSON.stringify(receipt).includes("cand-2"), false);
});

test("verifies a valid receipt hash from ballot metadata", () => {
  const receipt = createVoteReceipt({
    electionId: "election-123",
    voteId: "vote-456",
    submittedAt: new Date("2026-09-26T12:00:00.000Z"),
  });

  assert.equal(
    verifyVoteReceipt({
      electionId: receipt.electionId,
      voteId: receipt.voteId,
      submittedAt: new Date(receipt.submittedAt),
      recordHash: receipt.recordHash,
    }),
    true,
  );
});
