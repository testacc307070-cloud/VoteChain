
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

export {
  createVoteReceipt,
  verifyVoteReceipt,
  type VoteReceipt,
} from "@/verification/receipts";
