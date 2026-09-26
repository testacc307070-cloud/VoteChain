export type AuthorityApproval = {
  authorityId: string;
  approved: boolean;
};

export type AuthorityThresholdResult = {
  approvals: number;
  required: number;
  approved: boolean;
  status: "APPROVED" | "PENDING" | "REJECTED";
};

export type AuthorityReviewStatus = AuthorityThresholdResult & {
  canPublish: boolean;
};

export function evaluateAuthorityThreshold(
  approvals: AuthorityApproval[],
  required: number,
): AuthorityThresholdResult {
  const uniqueApprovals = new Map(approvals.map((entry) => [entry.authorityId, entry.approved]));
  const approvalsCount = [...uniqueApprovals.values()].filter(Boolean).length;
  const normalizedRequired = Math.max(1, Math.floor(required));
  const approved = approvalsCount >= normalizedRequired;

  return {
    approvals: approvalsCount,
    required: normalizedRequired,
    approved,
    status: approved ? "APPROVED" : approvalsCount > 0 ? "PENDING" : "REJECTED",
  };
}

export function buildAuthorityReviewStatus(
  approvals: AuthorityApproval[],
  required: number,
): AuthorityReviewStatus {
  const threshold = evaluateAuthorityThreshold(approvals, required);
  return {
    ...threshold,
    canPublish: threshold.approved,
  };
}

export function stringifyAuthorityStatus(result: AuthorityThresholdResult): string {
  return `${result.approvals}/${result.required} authorities approved`;
}
