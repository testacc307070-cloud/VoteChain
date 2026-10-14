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
  isTie: boolean;
  resultStatus: "WINNER_DECLARED" | "NO_RESULT_TIED" | "NO_RESULT_NO_VOTES";
  statusMessage: string;
  tiedCandidates: CandidateResult[];
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

  // Edge case: No votes cast or no candidates received valid votes
  if (candidateResults.length === 0 || votes.length === 0 || candidateResults[0].voteCount === 0) {
    return {
      totalVotes: votes.length,
      candidateResults,
      winner: null,
      isTie: false,
      resultStatus: "NO_RESULT_NO_VOTES",
      statusMessage: "No Result — no votes recorded",
      tiedCandidates: [],
    };
  }

  const highestVoteCount = candidateResults[0].voteCount;
  const topCandidates = candidateResults.filter((c) => c.voteCount === highestVoteCount);

  // If two or more candidates share the highest vote count, election result is "No Result"
  if (topCandidates.length > 1) {
    return {
      totalVotes: votes.length,
      candidateResults,
      winner: null,
      isTie: true,
      resultStatus: "NO_RESULT_TIED",
      statusMessage: "No Result — candidates are tied",
      tiedCandidates: topCandidates,
    };
  }

  // Exactly one candidate has the highest vote count
  return {
    totalVotes: votes.length,
    candidateResults,
    winner: candidateResults[0],
    isTie: false,
    resultStatus: "WINNER_DECLARED",
    statusMessage: `Winner: ${candidateResults[0].name}`,
    tiedCandidates: [],
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
