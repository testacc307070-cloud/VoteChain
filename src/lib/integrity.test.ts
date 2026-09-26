import assert from "node:assert/strict";
import test from "node:test";

import { buildElectionIntegritySnapshot, createMerkleProof, createMerkleRoot, verifyMerkleProof } from "./integrity";

test("creates a stable Merkle root from a list of vote hashes", () => {
  const root = createMerkleRoot([
    "vote-1",
    "vote-2",
    "vote-3",
    "vote-4",
  ]);

  assert.equal(typeof root, "string");
  assert.equal(root.startsWith("sha256:"), true);
  assert.equal(root.length > 24, true);
});

test("creates and verifies a Merkle inclusion proof", () => {
  const values = ["vote-a", "vote-b", "vote-c", "vote-d", "vote-e"];
  const root = createMerkleRoot(values);
  const proof = createMerkleProof(values, 2);

  assert.equal(verifyMerkleProof("vote-c", proof, root), true);
  assert.equal(verifyMerkleProof("vote-x", proof, root), false);
});

test("rejects an out-of-range Merkle proof request", () => {
  assert.throws(() => createMerkleProof(["vote-a"], 1), /out of range/);
});

test("builds a public integrity snapshot with verification metrics", () => {
  const snapshot = buildElectionIntegritySnapshot({
    electionId: "election-42",
    totalVotes: 8,
    validVotes: 8,
    invalidVotes: 0,
    blockHeight: 42,
  });

  assert.equal(snapshot.status, "VALID");
  assert.equal(snapshot.totalVotes, 8);
  assert.equal(snapshot.validVotes, 8);
  assert.equal(snapshot.invalidVotes, 0);
  assert.equal(snapshot.merkleRoot.startsWith("sha256:"), true);
});
