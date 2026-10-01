import assert from "node:assert/strict";
import test from "node:test";

import { createZkVoteProof, verifyZkVoteProof } from "@/security/zk-proof";

test("creates a true zero-knowledge proof for a valid candidate choice", async () => {
  const proof = await createZkVoteProof({
    electionId: "election-123",
    candidateId: "cand-2",
    validCandidateIds: ["cand-1", "cand-2", "cand-3"],
    nonce: "demo-nonce",
  });

  assert.equal(proof.valid, true);
  assert.equal(proof.proof.startsWith("zk:babyjub:"), true);
  assert.equal(proof.publicStatement.includes("cand-2"), false);
  assert.equal(proof.proof.includes("cand-2"), false);
});

test("verifies a valid zero-knowledge proof for the allowed candidate set", async () => {
  const proof = await createZkVoteProof({
    electionId: "election-123",
    candidateId: "cand-1",
    validCandidateIds: ["cand-1", "cand-2", "cand-3"],
    nonce: "demo-nonce-2",
  });

  const verified = await verifyZkVoteProof({
    electionId: "election-123",
    proof,
    validCandidateIds: ["cand-1", "cand-2", "cand-3"],
  });

  assert.equal(verified, true);
});

test("rejects a proof for a candidate outside the valid set", async () => {
  const proof = await createZkVoteProof({
    electionId: "election-123",
    candidateId: "cand-9",
    validCandidateIds: ["cand-1", "cand-2", "cand-3"],
    nonce: "demo-nonce-3",
  });

  assert.equal(proof.valid, false);

  const verified = await verifyZkVoteProof({
    electionId: "election-123",
    proof,
    validCandidateIds: ["cand-1", "cand-2", "cand-3"],
  });

  assert.equal(verified, false);
});

test("rejects a tampered zero-knowledge proof payload", async () => {
  const proof = await createZkVoteProof({
    electionId: "election-123",
    candidateId: "cand-3",
    validCandidateIds: ["cand-1", "cand-2", "cand-3"],
    nonce: "demo-nonce-4",
  });

  // Tamper with the proof by altering one character of the base64url payload
  const raw = proof.proof.replace("zk:babyjub:", "");
  const tamperedProof = `zk:babyjub:${raw.slice(0, -2)}AA`;

  const verified = await verifyZkVoteProof({
    electionId: "election-123",
    proof: tamperedProof,
    validCandidateIds: ["cand-1", "cand-2", "cand-3"],
  });

  assert.equal(verified, false);
});

test("rejects proof when electionId does not match", async () => {
  const proof = await createZkVoteProof({
    electionId: "election-123",
    candidateId: "cand-1",
    validCandidateIds: ["cand-1", "cand-2"],
    nonce: "demo-nonce-5",
  });

  const verified = await verifyZkVoteProof({
    electionId: "different-election",
    proof,
    validCandidateIds: ["cand-1", "cand-2"],
  });

  assert.equal(verified, false);
});
