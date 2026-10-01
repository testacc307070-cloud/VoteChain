import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { generateElectionKey, getElectionEncryptionKey } from "@/security/election-keys";
import { encryptBallot, decryptBallot } from "@/security/encryption";

process.env.BALLOT_ENCRYPTION_KEY =
  process.env.BALLOT_ENCRYPTION_KEY || "test-ballot-encryption-key-with-32-chars";

test("Phase 9.1: Different elections receive distinct cryptographic keys and commitments", () => {
  const election1 = generateElectionKey();
  const election2 = generateElectionKey();

  assert.notEqual(election1.rawKey, election2.rawKey);
  assert.notEqual(election1.encryptedMasterKey, election2.encryptedMasterKey);
  assert.notEqual(election1.keyCommitment, election2.keyCommitment);

  // Each key is 256 bits (32 bytes = 64 hex characters)
  assert.equal(election1.rawKey.length, 64);
  assert.equal(election2.rawKey.length, 64);
  assert.match(election1.keyCommitment, /^sha256:[a-f0-9]{64}$/);
});

test("Phase 9.1: A ballot encrypted for Election A cannot be decrypted with Election B's key", () => {
  const electionAKey = generateElectionKey();
  const electionBKey = generateElectionKey();

  const validCandidateIds = ["candidate-alpha", "candidate-beta"];
  const candidateId = "candidate-alpha";
  const electionId = "election-test-a";
  const nonce = "test-nonce-12345";

  // Encrypt ballot using Election A's unique key
  const encryptedBallot = encryptBallot({
    electionId,
    candidateId,
    validCandidateIds,
    nonce,
    encryptionKey: electionAKey.rawKey,
  });

  // Decryption with Election A's key succeeds
  const decryptedWithA = decryptBallot({
    electionId,
    ballot: encryptedBallot,
    encryptionKey: electionAKey.rawKey,
  });
  assert.equal(decryptedWithA, candidateId);

  // Decryption with Election B's key must fail (AES-256-GCM authentication failure)
  assert.throws(
    () => {
      decryptBallot({
        electionId,
        ballot: encryptedBallot,
        encryptionKey: electionBKey.rawKey,
      });
    },
    /unable to authenticate data|Unsupported state/i,
  );
});

test("Phase 9.1: Existing AES-256-GCM functionality and legacy fallback work", () => {
  // 1. Decrypting per-election envelope works
  const envelope = generateElectionKey();
  const recoveredKey = getElectionEncryptionKey({
    encryptedMasterKey: envelope.encryptedMasterKey,
    keyCommitment: envelope.keyCommitment,
  });
  assert.equal(recoveredKey, envelope.rawKey);

  // 2. Legacy fallback when encryptedMasterKey is null/undefined
  const fallbackKey = getElectionEncryptionKey(null);
  assert.equal(typeof fallbackKey, "string");
  assert.ok(fallbackKey.length >= 32);

  // 3. Encrypting with legacy fallback works with default decrypt
  const legacyBallot = encryptBallot({
    electionId: "legacy-elec",
    candidateId: "cand-1",
    validCandidateIds: ["cand-1", "cand-2"],
    nonce: "legacy-nonce",
  });
  const decryptedLegacy = decryptBallot({
    electionId: "legacy-elec",
    ballot: legacyBallot,
  });
  assert.equal(decryptedLegacy, "cand-1");
});

test("Phase 9.1: Tampered master key commitment is detected and blocked", () => {
  const envelope = generateElectionKey();
  const tamperedCommitment = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

  assert.throws(
    () => {
      getElectionEncryptionKey({
        encryptedMasterKey: envelope.encryptedMasterKey,
        keyCommitment: tamperedCommitment,
      });
    },
    /Election master key commitment mismatch! Key tampering detected./,
  );
});

test("Phase 9.1: Security Boundary - No encryption key is exposed to the client bundle", () => {
  const clientDirs = [
    join(process.cwd(), "src", "frontend", "components"),
  ];

  for (const dir of clientDirs) {
    const files = readdirSync(dir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
    for (const file of files) {
      const content = readFileSync(join(dir, file), "utf8");
      // Must not import election-keys
      assert.ok(
        !content.includes("election-keys"),
        `Client component ${file} imports server election-keys module!`,
      );
      // Must not reference BALLOT_ENCRYPTION_KEY
      assert.ok(
        !content.includes("BALLOT_ENCRYPTION_KEY"),
        `Client component ${file} references BALLOT_ENCRYPTION_KEY!`,
      );
      // Must not reference encryptedMasterKey
      assert.ok(
        !content.includes("encryptedMasterKey"),
        `Client component ${file} references encryptedMasterKey!`,
      );
    }
  }
});
