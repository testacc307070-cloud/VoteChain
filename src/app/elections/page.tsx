import { redirect } from "next/navigation";
import ElectionManager from "@/components/election-manager";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export default async function ElectionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/portal");

  const elections = await prisma.election.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: { candidates: { orderBy: { sortOrder: "asc" } } },
  });
  const initialElections = elections.map((election) => ({
    ...election,
    startTime: election.startTime.toISOString(),
    endTime: election.endTime.toISOString(),
  }));

  return <ElectionManager displayName={user.name} initialElections={initialElections} />;
}