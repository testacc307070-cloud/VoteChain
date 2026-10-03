export type CandidateRecord = {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
};

export type ElectionTrusteeRecord = {
  id: string;
  authorityId: string;
  slotIndex: number;
  authority: {
    id: string;
    name: string;
    email: string;
    status: string;
  };
};

export type ElectionRecord = {
  id: string;
  name: string;
  description: string;
  startTime: string;
  endTime: string;
  status: "DRAFT" | "UPCOMING" | "ACTIVE" | "CLOSED" | "RESULTS_PUBLISHED";
  candidatesLocked: boolean;
  candidates: CandidateRecord[];
  votesCount?: number;
  eligibleVotersCount?: number;
  trusteesCount?: number;
  trustees?: ElectionTrusteeRecord[];
  observerAccessCodeHash?: string | null;
};