import { createHash } from "node:crypto";
import { decryptStoredBallots, type StoredEncryptedBallot } from "@/security/encryption";

export type CandidateSummary = {
  id: string;
  name: string;
};

export type VoteRecordSummary = {
  candidateId: string;
};

export type CandidateResult = {
  candidateId: string;
  name: string;
  voteCount: number;
};

export type ElectionResultsSummary = {
  totalVotes: number;
  candidateResults: CandidateResult[];
  winner: CandidateResult | null;
};

export function summarizeElectionResults(
  candidates: CandidateSummary[],
  votes: VoteRecordSummary[],
): ElectionResultsSummary {
  const tally = new Map<string, number>();

  for (const vote of votes) {
    tally.set(vote.candidateId, (tally.get(vote.candidateId) ?? 0) + 1);
  }

  const candidateResults = candidates
    .map((candidate) => ({
      candidateId: candidate.id,
      name: candidate.name,
      voteCount: tally.get(candidate.id) ?? 0,
    }))
    .sort((left, right) => right.voteCount - left.voteCount || left.name.localeCompare(right.name));

  const winner = candidateResults.length > 0 ? candidateResults[0] : null;

  return {
    totalVotes: votes.length,
    candidateResults,
    winner,
  };
}

export function summarizeStoredElectionResults(
  electionId: string,
  candidates: CandidateSummary[],
  ballots: StoredEncryptedBallot[],
  encryptionKey?: string,
) {
  const votes = decryptStoredBallots({
    electionId,
    validCandidateIds: candidates.map((candidate) => candidate.id),
    ballots,
    encryptionKey,
  });

  return summarizeElectionResults(candidates, votes);
}

export function createElectionAuditDigest({
  electionId,
  totalVotes,
  candidateResults,
  publishedAt,
}: {
  electionId: string;
  totalVotes: number;
  candidateResults: CandidateResult[];
  publishedAt: Date;
}): string {
  const payload = JSON.stringify({
    electionId,
    totalVotes,
    candidateResults: candidateResults.map(({ candidateId, voteCount }) => ({ candidateId, voteCount })),
    publishedAt: publishedAt.toISOString(),
  });

  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}
