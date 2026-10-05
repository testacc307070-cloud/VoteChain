import { redirect } from "next/navigation";
import { prisma } from "@/database/prisma";
import { getCurrentUser } from "@/backend/auth/session";
import { checkVoterElectionEligibility } from "@/backend/voting/eligibility";
import VoterPortalClient from "@/frontend/components/voter-portal-client";

export default async function PortalPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "ADMIN") redirect("/");
  if (user.role === "AUTHORITY") redirect("/authority");
  if (user.role === "OBSERVER") redirect("/observer");

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

  const formattedElections = await Promise.all(
    activeElections.map(async (election) => {
      const eligibility = await checkVoterElectionEligibility({
        userId: user.id,
        email: user.email,
        voterId: user.voterId,
        role: user.role,
        emailVerified: Boolean(user.emailVerified),
        electionId: election.id,
      });

      return {
        id: election.id,
        name: election.name,
        description: election.description,
        startTime: election.startTime.toISOString(),
        endTime: election.endTime.toISOString(),
        hasVoted: election.participations.length > 0 || election.votes.length > 0,
        isEligible: eligibility.ok,
        eligibilityReason: eligibility.reason,
        candidates: election.candidates.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          sortOrder: c.sortOrder,
        })),
      };
    })
  );

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