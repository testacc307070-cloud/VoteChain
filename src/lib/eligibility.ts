export type EligibilityCheckInput = {
  userId: string;
  eligibleVoterIds: string[];
  isEligible: boolean;
};

export type EligibilityCheckResult =
  | { ok: true; voterId: string }
  | { ok: false; reason: string };

export function checkElectionEligibility({
  userId,
  eligibleVoterIds,
  isEligible,
}: EligibilityCheckInput): EligibilityCheckResult {
  if (!userId || userId.trim().length === 0) {
    return { ok: false, reason: "A valid voter identifier is required." };
  }

  if (!isEligible) {
    return { ok: false, reason: "This voter is not eligible for the election." };
  }

  if (!eligibleVoterIds.includes(userId)) {
    return { ok: false, reason: "This voter is not registered for the election." };
  }

  return { ok: true, voterId: userId };
}
