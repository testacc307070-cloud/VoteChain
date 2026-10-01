import { createHash } from "node:crypto";

export type VoteReceipt = {
  receiptId: string;
  electionId: string;
  voteId: string;
  recordHash: string;
  txHash: string;
  blockNumber: number;
  submittedAt: string;
};

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
