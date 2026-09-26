import { createCipheriv, createDecipheriv, createHash } from "node:crypto";

export type EncryptedBallot = {
  ciphertext: string;
  proof: string;
  voterHash: string;
  nonce: string;
  authTag: string;
};

function encryptionKey(explicitKey?: string) {
  const source = explicitKey ?? process.env.BALLOT_ENCRYPTION_KEY;
  if (!source || source.length < 32) {
    throw new Error("BALLOT_ENCRYPTION_KEY must contain at least 32 characters.");
  }
  return createHash("sha256").update(source).digest();
}

export function encryptBallot({
  electionId,
  voterId,
  candidateId,
  validCandidateIds,
  nonce,
  encryptionKey: key,
}: {
  electionId: string;
  voterId: string;
  candidateId: string;
  validCandidateIds: string[];
  nonce: string;
  encryptionKey?: string;
}): EncryptedBallot {
  if (!validCandidateIds.includes(candidateId)) {
    throw new Error("Candidate is not valid for this election.");
  }

  const voterHash = createHash("sha256").update(`${electionId}:${voterId}`).digest("hex");
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(key), createHash("sha256").update(nonce).digest().subarray(0, 12));
  cipher.setAAD(Buffer.from(`${electionId}:${voterHash}`));
  const ciphertext = `enc:${Buffer.concat([cipher.update(candidateId, "utf8"), cipher.final()]).toString("base64url")}`;
  const authTag = cipher.getAuthTag().toString("base64url");
  const proof = `proof:${createHash("sha256")
    .update(`${electionId}:${ciphertext}:${authTag}:${validCandidateIds.slice().sort().join("|")}`)
    .digest("hex")}`;

  return {
    ciphertext,
    proof,
    voterHash,
    nonce,
    authTag,
  };
}

export function decryptBallot({
  electionId,
  voterId,
  ballot,
  encryptionKey: key,
}: {
  electionId: string;
  voterId: string;
  ballot: EncryptedBallot;
  encryptionKey?: string;
}): string {
  const voterHash = createHash("sha256").update(`${electionId}:${voterId}`).digest("hex");
  if (ballot.voterHash !== voterHash) throw new Error("Ballot voter context does not match.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(key), createHash("sha256").update(ballot.nonce).digest().subarray(0, 12));
  decipher.setAAD(Buffer.from(`${electionId}:${voterHash}`));
  decipher.setAuthTag(Buffer.from(ballot.authTag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ballot.ciphertext.replace(/^enc:/, ""), "base64url")), decipher.final()]).toString("utf8");
}

export function verifyEncryptedBallot({
  electionId,
  voterId,
  candidateId,
  validCandidateIds,
  ballot,
  encryptionKey: key,
}: {
  electionId: string;
  voterId: string;
  candidateId: string;
  validCandidateIds: string[];
  ballot: EncryptedBallot;
  encryptionKey?: string;
}): boolean {
  if (!validCandidateIds.includes(candidateId)) {
    return false;
  }

  const expectedVoterHash = createHash("sha256").update(`${electionId}:${voterId}`).digest("hex");
  if (ballot.voterHash !== expectedVoterHash) {
    return false;
  }

  const expectedProof = `proof:${createHash("sha256")
    .update(`${electionId}:${ballot.ciphertext}:${ballot.authTag}:${validCandidateIds.slice().sort().join("|")}`)
    .digest("hex")}`;

  if (ballot.proof !== expectedProof) return false;

  try {
    return decryptBallot({ electionId, voterId, ballot, encryptionKey: key }) === candidateId;
  } catch {
    return false;
  }
}
