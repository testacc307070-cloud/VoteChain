import { redirect } from "next/navigation";
import ElectionManager from "@/frontend/components/election-manager";
import { prisma } from "@/database/prisma";
import { getCurrentUser } from "@/backend/auth/session";

export default async function ElectionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/portal");

  const elections = await prisma.election.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: {
      candidates: { orderBy: { sortOrder: "asc" } },
      _count: { select: { votes: true } },
    },
  });
  const initialElections = elections.map((election) => ({
    ...election,
    startTime: election.startTime.toISOString(),
    endTime: election.endTime.toISOString(),
    votesCount: election._count.votes,
  }));

  return <ElectionManager displayName={user.name} initialElections={initialElections} />;
}