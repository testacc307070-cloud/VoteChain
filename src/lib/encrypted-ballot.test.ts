import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import test from "node:test";

import { decryptStoredBallots, encryptBallot, verifyEncryptedBallot } from "./encrypted-ballot";

const encryptionKey = "test-ballot-encryption-key-with-32-chars";

function createLegacyBallot({
  electionId,
  voterId,
  candidateId,
  validCandidateIds,
  nonce,
}: {
  electionId: string;
  voterId: string;
  candidateId: string;
  validCandidateIds: string[];
  nonce: string;
}) {
  const voterHash = createHash("sha256").update(`${electionId}:${voterId}`).digest("hex");
  const key = createHash("sha256").update(encryptionKey).digest();
  const iv = createHash("sha256").update(nonce).digest().subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${electionId}:${voterHash}`));
  const ciphertext = `enc:${Buffer.concat([cipher.update(candidateId, "utf8"), cipher.final()]).toString("base64url")}`;
  const authTag = cipher.getAuthTag().toString("base64url");
  const proof = `proof:${createHash("sha256")
    .update(`${electionId}:${ciphertext}:${authTag}:${validCandidateIds.slice().sort().join("|")}`)
    .digest("hex")}`;

  return { ciphertext, authTag, proof, nonce };
}

test("creates a voter-independent encrypted ballot and verifies its choice", () => {
  const ballot = encryptBallot({
    electionId: "election-1",
    candidateId: "candidate-a",
    validCandidateIds: ["candidate-a", "candidate-b", "candidate-c"],
    nonce: "seed-123",
    encryptionKey,
  });

  const verified = verifyEncryptedBallot({
    electionId: "election-1",
    candidateId: "candidate-a",
    validCandidateIds: ["candidate-a", "candidate-b", "candidate-c"],
    ballot,
    encryptionKey,
  });

  assert.equal(ballot.ciphertext.startsWith("enc:"), true);
  assert.equal(ballot.ciphertext.includes("candidate-a"), false);
  assert.equal("voterHash" in ballot, false);
  assert.equal(ballot.proof.startsWith("proof:"), true);
  assert.equal(verified, true);
});

test("rejects a ballot when the candidate does not match the ciphertext", () => {
  const ballot = encryptBallot({
    electionId: "election-1",
    candidateId: "candidate-a",
    validCandidateIds: ["candidate-a", "candidate-b", "candidate-c"],
    nonce: "seed-123",
    encryptionKey,
  });

  const verified = verifyEncryptedBallot({
    electionId: "election-1",
    candidateId: "candidate-b",
    validCandidateIds: ["candidate-a", "candidate-b", "candidate-c"],
    ballot,
    encryptionKey,
  });

  assert.equal(verified, false);
});

test("decrypts a stored anonymous ballot for tallying without a voter link", () => {
  const ballot = encryptBallot({
    electionId: "election-1",
    candidateId: "candidate-a",
    validCandidateIds: ["candidate-a", "candidate-b"],
    nonce: "vote-123",
    encryptionKey,
  });

  const votes = decryptStoredBallots({
    electionId: "election-1",
    validCandidateIds: ["candidate-a", "candidate-b"],
    ballots: [{
      candidateId: null,
      voterId: null,
      encryptedBallot: ballot.ciphertext,
      ballotNonce: ballot.nonce,
      ballotAuthTag: ballot.authTag,
      ballotProof: ballot.proof,
    }],
    encryptionKey,
  });

  assert.deepEqual(votes, [{ candidateId: "candidate-a" }]);
});

test("rejects a stored anonymous ballot with a modified proof", () => {
  const ballot = encryptBallot({
    electionId: "election-1",
    candidateId: "candidate-a",
    validCandidateIds: ["candidate-a", "candidate-b"],
    nonce: "vote-456",
    encryptionKey,
  });

  assert.throws(() => decryptStoredBallots({
    electionId: "election-1",
    validCandidateIds: ["candidate-a", "candidate-b"],
    ballots: [{
      candidateId: null,
      voterId: null,
      encryptedBallot: ballot.ciphertext,
      ballotNonce: ballot.nonce,
      ballotAuthTag: ballot.authTag,
      ballotProof: "proof:tampered",
    }],
    encryptionKey,
  }), /integrity verification failed/);
});

test("continues tallying legacy ballots during the schema transition", () => {
  const validCandidateIds = ["candidate-a", "candidate-b"];
  const ballot = createLegacyBallot({
    electionId: "election-1",
    voterId: "user-42",
    candidateId: "candidate-b",
    validCandidateIds,
    nonce: "legacy-vote-1",
  });

  const votes = decryptStoredBallots({
    electionId: "election-1",
    validCandidateIds,
    ballots: [{
      candidateId: "candidate-b",
      voterId: "user-42",
      encryptedBallot: ballot.ciphertext,
      ballotNonce: ballot.nonce,
      ballotAuthTag: ballot.authTag,
      ballotProof: ballot.proof,
    }],
    encryptionKey,
  });

  assert.deepEqual(votes, [{ candidateId: "candidate-b" }]);
});
