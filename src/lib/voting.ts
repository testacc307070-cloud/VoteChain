import { createHash } from "node:crypto";

export type VoteSubmissionInput = {
  electionId: string;
  candidateId: string;
  validCandidateIds: string[];
  hasExistingVote: boolean;
  startTime?: Date;
  endTime?: Date;
  now?: Date;
};

export type VoteValidationResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

export type VoteReceipt = {
  receiptId: string;
  electionId: string;
  voteId: string;
  recordHash: string;
  txHash: string;
  blockNumber: number;
  submittedAt: string;
};

export function validateVoteSubmission({
  electionId,
  candidateId,
  validCandidateIds,
  hasExistingVote,
  startTime,
  endTime,
  now,
}: VoteSubmissionInput): VoteValidationResult {
  if (!electionId || electionId.trim().length === 0) {
    return { ok: false, error: "Election is required." };
  }

  if (!candidateId || candidateId.trim().length === 0) {
    return { ok: false, error: "A valid candidate selection is required." };
  }

  if (!validCandidateIds.includes(candidateId)) {
    return { ok: false, error: "The selected candidate is not eligible for this election." };
  }

  if (hasExistingVote) {
    return { ok: false, error: "This voter has already voted in this election." };
  }

  if (startTime && endTime) {
    const currentTime = now ?? new Date();
    if (currentTime < startTime || currentTime >= endTime) {
      return { ok: false, error: "Voting is only allowed during the active election time window." };
    }
  }

  return { ok: true };
}

export function createVoteReceipt({
  electionId,
  voteId,
  submittedAt,
}: {
  electionId: string;
  voteId: string;
  submittedAt: Date;
}): VoteReceipt {
  const base = `${electionId}:${voteId}:${submittedAt.toISOString()}`;
  const recordHash = createHash("sha256").update(base).digest("hex");
  const txHash = `0x${recordHash.slice(0, 32)}`;
  const blockNumber = Number.parseInt(recordHash.slice(0, 8), 16) % 900000 + 1;

  return {
    receiptId: `RCPT-${recordHash.slice(0, 12).toUpperCase()}`,
    electionId,
    voteId,
    recordHash,
    txHash,
    blockNumber,
    submittedAt: submittedAt.toISOString(),
  };
}

export function verifyVoteReceipt({
  electionId,
  voteId,
  submittedAt,
  recordHash,
}: {
  electionId: string;
  voteId: string;
  submittedAt: Date | string;
  recordHash: string;
}) {
  const dateObj = typeof submittedAt === "string" ? new Date(submittedAt) : submittedAt;
  const expectedHash = createHash("sha256")
    .update(`${electionId}:${voteId}:${dateObj.toISOString()}`)
    .digest("hex");

  return expectedHash === recordHash;
}
