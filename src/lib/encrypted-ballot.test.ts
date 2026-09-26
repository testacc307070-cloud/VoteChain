import assert from "node:assert/strict";
import test from "node:test";

import { encryptBallot, verifyEncryptedBallot } from "./encrypted-ballot";

const encryptionKey = "test-ballot-encryption-key-with-32-chars";

test("creates a deterministic encrypted ballot and verifies it without exposing the candidate", () => {
  const ballot = encryptBallot({
    electionId: "election-1",
    voterId: "user-42",
    candidateId: "candidate-a",
    validCandidateIds: ["candidate-a", "candidate-b", "candidate-c"],
    nonce: "seed-123",
    encryptionKey,
  });

  const verified = verifyEncryptedBallot({
    electionId: "election-1",
    voterId: "user-42",
    candidateId: "candidate-a",
    validCandidateIds: ["candidate-a", "candidate-b", "candidate-c"],
    ballot,
    encryptionKey,
  });

  assert.equal(ballot.ciphertext.startsWith("enc:"), true);
  assert.equal(ballot.proof.startsWith("proof:"), true);
  assert.equal(verified, true);
});

test("rejects a ballot when the candidate or voter context no longer matches", () => {
  const ballot = encryptBallot({
    electionId: "election-1",
    voterId: "user-42",
    candidateId: "candidate-a",
    validCandidateIds: ["candidate-a", "candidate-b", "candidate-c"],
    nonce: "seed-123",
    encryptionKey,
  });

  const verified = verifyEncryptedBallot({
    electionId: "election-1",
    voterId: "user-42",
    candidateId: "candidate-b",
    validCandidateIds: ["candidate-a", "candidate-b", "candidate-c"],
    ballot,
    encryptionKey,
  });

  assert.equal(verified, false);
});
