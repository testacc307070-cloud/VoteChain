export type CandidateRecord = {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
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
};