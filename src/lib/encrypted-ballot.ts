import { createCipheriv, createDecipheriv, createHash } from "node:crypto";

export type EncryptedBallot = {
  ciphertext: string;
  proof: string;
  nonce: string;
  authTag: string;
};

export type StoredEncryptedBallot = {
  candidateId: string | null;
  voterId: string | null;
  encryptedBallot: string;
  ballotNonce: string;
  ballotAuthTag: string;
  ballotProof: string;
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
  candidateId,
  validCandidateIds,
  nonce,
  encryptionKey: key,
}: {
  electionId: string;
  candidateId: string;
  validCandidateIds: string[];
  nonce: string;
  encryptionKey?: string;
}): EncryptedBallot {
  if (!validCandidateIds.includes(candidateId)) {
    throw new Error("Candidate is not valid for this election.");
  }

  const cipher = createCipheriv("aes-256-gcm", encryptionKey(key), createHash("sha256").update(nonce).digest().subarray(0, 12));
  cipher.setAAD(Buffer.from(electionId));
  const ciphertext = `enc:${Buffer.concat([cipher.update(candidateId, "utf8"), cipher.final()]).toString("base64url")}`;
  const authTag = cipher.getAuthTag().toString("base64url");
  const proof = `proof:${createHash("sha256")
    .update(`${electionId}:${ciphertext}:${authTag}:${validCandidateIds.slice().sort().join("|")}`)
    .digest("hex")}`;

  return {
    ciphertext,
    proof,
    nonce,
    authTag,
  };
}

export function decryptBallot({
  electionId,
  ballot,
  encryptionKey: key,
}: {
  electionId: string;
  ballot: EncryptedBallot;
  encryptionKey?: string;
}): string {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(key), createHash("sha256").update(ballot.nonce).digest().subarray(0, 12));
  decipher.setAAD(Buffer.from(electionId));
  decipher.setAuthTag(Buffer.from(ballot.authTag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ballot.ciphertext.replace(/^enc:/, ""), "base64url")), decipher.final()]).toString("utf8");
}

export function verifyEncryptedBallot({
  electionId,
  candidateId,
  validCandidateIds,
  ballot,
  encryptionKey: key,
}: {
  electionId: string;
  candidateId: string;
  validCandidateIds: string[];
  ballot: EncryptedBallot;
  encryptionKey?: string;
}): boolean {
  if (!validCandidateIds.includes(candidateId)) {
    return false;
  }

  const expectedProof = `proof:${createHash("sha256")
    .update(`${electionId}:${ballot.ciphertext}:${ballot.authTag}:${validCandidateIds.slice().sort().join("|")}`)
    .digest("hex")}`;

  if (ballot.proof !== expectedProof) return false;

  try {
    return decryptBallot({ electionId, ballot, encryptionKey: key }) === candidateId;
  } catch {
    return false;
  }
}

export function decryptLegacyBallot({
  electionId,
  voterId,
  ballot,
  encryptionKey: key,
}: {
  electionId: string;
  voterId: string;
  ballot: EncryptedBallot;
  encryptionKey?: string;
}) {
  const voterHash = createHash("sha256").update(`${electionId}:${voterId}`).digest("hex");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(key), createHash("sha256").update(ballot.nonce).digest().subarray(0, 12));
  decipher.setAAD(Buffer.from(`${electionId}:${voterHash}`));
  decipher.setAuthTag(Buffer.from(ballot.authTag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ballot.ciphertext.replace(/^enc:/, ""), "base64url")), decipher.final()]).toString("utf8");
}

export function decryptStoredBallots({
  electionId,
  validCandidateIds,
  ballots,
  encryptionKey: key,
}: {
  electionId: string;
  validCandidateIds: string[];
  ballots: StoredEncryptedBallot[];
  encryptionKey?: string;
}) {
  return ballots.map((ballot) => {
    const encryptedBallot: EncryptedBallot = {
      ciphertext: ballot.encryptedBallot,
      nonce: ballot.ballotNonce,
      authTag: ballot.ballotAuthTag,
      proof: ballot.ballotProof,
    };
    let candidateId: string;

    if (ballot.candidateId && ballot.voterId) {
      candidateId = decryptLegacyBallot({ electionId, voterId: ballot.voterId, ballot: encryptedBallot, encryptionKey: key });
      const expectedProof = `proof:${createHash("sha256")
        .update(`${electionId}:${encryptedBallot.ciphertext}:${encryptedBallot.authTag}:${validCandidateIds.slice().sort().join("|")}`)
        .digest("hex")}`;
      if (candidateId !== ballot.candidateId || encryptedBallot.proof !== expectedProof) {
        throw new Error("Legacy ballot integrity verification failed.");
      }
    } else {
      candidateId = decryptBallot({ electionId, ballot: encryptedBallot, encryptionKey: key });
      if (!verifyEncryptedBallot({ electionId, candidateId, validCandidateIds, ballot: encryptedBallot, encryptionKey: key })) {
        throw new Error("Ballot integrity verification failed.");
      }
    }

    if (!validCandidateIds.includes(candidateId)) {
      throw new Error("Ballot contains a candidate outside this election.");
    }

    return { candidateId };
  });
}
