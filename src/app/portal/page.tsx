import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import VoterPortalClient from "@/components/voter-portal-client";

export default async function PortalPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "ADMIN") redirect("/");

  const params = (await searchParams) ?? {};
  const receiptId = typeof params.receiptId === "string" ? params.receiptId : undefined;
  const receiptElectionId = typeof params.electionId === "string" ? params.electionId : undefined;
  const txHash = typeof params.txHash === "string" ? params.txHash : undefined;
  const blockNumber = typeof params.blockNumber === "string" ? params.blockNumber : undefined;
  const recordHash = typeof params.recordHash === "string" ? params.recordHash : undefined;
  const submittedAt = typeof params.submittedAt === "string" ? params.submittedAt : undefined;
  const voteId = typeof params.voteId === "string" ? params.voteId : undefined;

  const initialReceipt =
    receiptId && receiptElectionId && recordHash && submittedAt && voteId && txHash
      ? {
          receiptId,
          electionId: receiptElectionId,
          voteId,
          txHash,
          blockNumber: blockNumber ?? "1",
          recordHash,
          submittedAt,
          zkVerified: typeof params.zkVerified === "string" ? params.zkVerified : "true",
        }
      : undefined;

  const activeElections = await prisma.election.findMany({
    where: { status: "ACTIVE" },
    include: {
      candidates: { orderBy: { sortOrder: "asc" } },
      participations: { where: { voterId: user.id }, select: { id: true } },
      votes: { where: { voterId: user.id }, select: { id: true } },
    },
    orderBy: [{ startTime: "asc" }],
  });

  const formattedElections = activeElections.map((election) => ({
    id: election.id,
    name: election.name,
    description: election.description,
    startTime: election.startTime.toISOString(),
    endTime: election.endTime.toISOString(),
    hasVoted: election.participations.length > 0 || election.votes.length > 0,
    candidates: election.candidates.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      sortOrder: c.sortOrder,
    })),
  }));

  return (
    <VoterPortalClient
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        voterId: user.voterId,
        role: user.role,
      }}
      activeElections={formattedElections}
      initialReceipt={initialReceipt}
    />
  );
}