export type ElectionAuditEvent = {
  title: string;
  detail: string;
  timestamp: string;
  tag: string;
};

export function buildElectionAuditTrail({
  electionId,
  electionName,
  startTime,
  endTime,
  publishedAt,
  totalVotes,
  digest,
}: {
  electionId: string;
  electionName: string;
  startTime: Date;
  endTime: Date;
  publishedAt: Date;
  totalVotes: number;
  digest: string;
}): ElectionAuditEvent[] {
  return [
    {
      title: "Election created",
      detail: `${electionName} was configured for election ${electionId}.`,
      timestamp: startTime.toISOString(),
      tag: "SETUP",
    },
    {
      title: "Candidate list locked",
      detail: "The ballot configuration was finalized before the election opened.",
      timestamp: startTime.toISOString(),
      tag: "LOCK",
    },
    {
      title: "Election closed",
      detail: `Voting closed at ${endTime.toISOString()}.`,
      timestamp: endTime.toISOString(),
      tag: "CLOSE",
    },
    {
      title: "Results published",
      detail: `Total valid votes: ${totalVotes}. Verification digest: ${digest}.`,
      timestamp: publishedAt.toISOString(),
      tag: "VERIFY",
    },
  ];
}
