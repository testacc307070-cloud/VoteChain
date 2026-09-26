import assert from "node:assert/strict";
import test from "node:test";

import { createZkVoteProof, verifyZkVoteProof } from "./zk-proof";

test("creates a zero-knowledge style proof for a valid candidate choice", () => {
  const proof = createZkVoteProof({
    electionId: "election-123",
    candidateId: "cand-2",
    validCandidateIds: ["cand-1", "cand-2", "cand-3"],
    nonce: "demo-nonce",
  });

  assert.equal(proof.valid, true);
  assert.equal(proof.proof.startsWith("zk:"), true);
  assert.equal(proof.publicStatement.includes("cand-2") === false, true);
});

test("verifies a valid zero-knowledge style proof for the allowed candidate set", () => {
  const proof = createZkVoteProof({
    electionId: "election-123",
    candidateId: "cand-1",
    validCandidateIds: ["cand-1", "cand-2", "cand-3"],
    nonce: "demo-nonce-2",
  });

  assert.equal(verifyZkVoteProof({
    electionId: "election-123",
    proof,
    validCandidateIds: ["cand-1", "cand-2", "cand-3"],
  }), true);
});

test("rejects a proof for a candidate outside the valid set", () => {
  const proof = createZkVoteProof({
    electionId: "election-123",
    candidateId: "cand-9",
    validCandidateIds: ["cand-1", "cand-2", "cand-3"],
    nonce: "demo-nonce-3",
  });

  assert.equal(proof.valid, false);
  assert.equal(verifyZkVoteProof({
    electionId: "election-123",
    proof,
    validCandidateIds: ["cand-1", "cand-2", "cand-3"],
  }), false);
});
