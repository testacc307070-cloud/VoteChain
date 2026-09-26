import { createHash } from "node:crypto";

export type ZkProofInput = {
  electionId: string;
  candidateId: string;
  validCandidateIds: string[];
  nonce: string;
};

export type ZkVoteProof = {
  proof: string;
  valid: boolean;
  publicStatement: string;
};

export function createZkVoteProof({
  electionId,
  candidateId,
  validCandidateIds,
  nonce,
}: ZkProofInput): ZkVoteProof {
  const isValidChoice = validCandidateIds.includes(candidateId);
  const evidence = createHash("sha256")
    .update(`${electionId}:${candidateId}:${nonce}:${validCandidateIds.join("|")}`)
    .digest("hex");

  const proof = `zk:${evidence}`;

  return {
    proof,
    valid: isValidChoice,
    publicStatement: `valid-candidate:${proof}`,
  };
}

export function verifyZkVoteProof({
  electionId,
  proof,
  validCandidateIds,
}: {
  electionId: string;
  proof: ZkVoteProof;
  validCandidateIds: string[];
}) {
  if (!proof.valid || !proof.proof.startsWith("zk:")) {
    return false;
  }

  const expectedPrefix = `valid-candidate:zk:`;
  return proof.publicStatement.startsWith(expectedPrefix) &&
    proof.proof.includes("zk:") &&
    validCandidateIds.length > 0 &&
    electionId.trim().length > 0;
}
