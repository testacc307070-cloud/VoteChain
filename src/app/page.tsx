import { redirect } from "next/navigation";
import { prisma } from "@/database/prisma";
import DashboardClient, {
  type DashboardMetrics,
  type ActivityItem,
  type UserItem,
  type AuthorityItem,
  type DashboardElectionItem,
} from "@/frontend/components/dashboard-client";
import { getCurrentUser } from "@/backend/auth/session";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/portal");

  const [
    votersCount,
    totalVotes,
    activeElection,
    rawAuditLogs,
    rawUsers,
    rawAllElections,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "VOTER" } }),
    prisma.electionVote.count(),
    prisma.election.findFirst({
      where: { status: "ACTIVE" },
      include: {
        candidates: { orderBy: { sortOrder: "asc" } },
        _count: { select: { votes: true } },
      },
    }),
    prisma.auditLog.findMany({
      take: 8,
      orderBy: { timestamp: "desc" },
    }),
    prisma.user.findMany({
      select: {
        id: true,
        voterId: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
      orderBy: [{ role: "asc" }, { createdAt: "desc" }],
    }),
    prisma.election.findMany({
      orderBy: [{ updatedAt: "desc" }],
      include: {
        candidates: { orderBy: { sortOrder: "asc" } },
        _count: { select: { votes: true } },
      },
    }),
  ]);

  const rawAuthorities = rawUsers
    .filter((u) => u.role === "AUTHORITY")
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt,
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const activeElectionsCount = activeElection ? 1 : 0;
  const participationRate =
    votersCount > 0 && activeElection
      ? Math.round((activeElection._count.votes / votersCount) * 100)
      : 0;

  const metrics: DashboardMetrics = {
    votersCount,
    activeElectionsCount,
    totalVotes,
    participationRate,
    authoritiesCount: rawAuthorities.length,
    activeElection: activeElection
      ? {
          id: activeElection.id,
          name: activeElection.name,
          description: activeElection.description,
          candidatesCount: activeElection.candidates.length,
          candidates: activeElection.candidates.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            sortOrder: c.sortOrder,
          })),
          votesCount: activeElection._count.votes,
          endTime: activeElection.endTime.toISOString(),
        }
      : null,
  };

  const recentActivities: ActivityItem[] = rawAuditLogs.map((log) => ({
    time: new Date(log.timestamp).toLocaleTimeString(),
    title: log.eventType.replaceAll("_", " "),
    detail: log.details || `Action by ${log.actorReference}`,
    tag: log.eventType.split("_")[0] || "AUDIT",
    color: log.eventType.includes("FAIL") || log.eventType.includes("FLAG") ? "orange" : "green",
  }));

  const initialUsers: UserItem[] = rawUsers.map((u) => ({
    id: u.id,
    voterId: u.voterId,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt.toISOString(),
  }));

  const initialAuthorities: AuthorityItem[] = rawAuthorities.map((a, idx) => ({
    id: a.id,
    authorityIndex: idx + 1,
    name: a.name,
    email: a.email,
    role: a.role,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
  }));

  const initialElections: DashboardElectionItem[] = rawAllElections.map((e) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    status: e.status,
    startTime: e.startTime.toISOString(),
    endTime: e.endTime.toISOString(),
    candidatesCount: e.candidates.length,
    votesCount: e._count.votes,
  }));

  return (
    <DashboardClient
      displayName={user.name}
      role={user.role}
      metrics={metrics}
      recentActivities={recentActivities}
      initialUsers={initialUsers}
      initialAuthorities={initialAuthorities}
      initialElections={initialElections}
    />
  );
}