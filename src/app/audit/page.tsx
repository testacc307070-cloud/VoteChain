import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { buildElectionAuditTrail } from "@/lib/audit";
import { redirect } from "next/navigation";

export default async function AuditPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const elections = await prisma.election.findMany({
    where: { status: { in: ["CLOSED", "RESULTS_PUBLISHED"] } },
    include: { candidates: true, votes: { select: { candidateId: true } } },
    orderBy: [{ updatedAt: "desc" }],
  });

  return (
    <main className="portal-shell">
      <header className="portal-header">
        <Link className="brand" href={user.role === "ADMIN" ? "/" : "/portal"} aria-label="VoteChain home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </Link>
        <form action="/api/auth/logout" method="post">
          <button className="portal-signout" type="submit">Sign out</button>
        </form>
      </header>

      <section className="portal-content">
        <p className="eyebrow">AUDIT / INTEGRITY REVIEW</p>
        <h1>Election audit trail</h1>
        <p className="page-subtitle">Lifecycle events are recorded as a tamper-evident sequence without revealing voter identities.</p>

        {elections.length === 0 ? (
          <div className="election-empty">
            <strong>No closed elections yet.</strong>
            <span>Once an election closes and is published, the audit trail will appear here.</span>
          </div>
        ) : (
          <div className="election-record-list" style={{ marginTop: "2rem" }}>
            {elections.map((election) => {
              const trail = buildElectionAuditTrail({
                electionId: election.id,
                electionName: election.name,
                startTime: election.startTime,
                endTime: election.endTime,
                publishedAt: election.resultsPublishedAt ?? election.endTime,
                totalVotes: election.votes.length,
                digest: `sha256:${election.id}`,
              });

              return (
                <article className="election-record" key={election.id}>
                  <div className="record-heading">
                    <div>
                      <span className="record-id">{election.id}</span>
                      <h3>{election.name}</h3>
                    </div>
                    <span className="election-status status-closed"><i />{election.status}</span>
                  </div>

                  <div className="record-candidates" style={{ marginTop: "1rem" }}>
                    {trail.map((event) => (
                      <div className="candidate-readonly" key={`${election.id}-${event.title}`}>
                        <span className="candidate-order">{event.tag}</span>
                        <span className="candidate-readonly-name">{event.title}<small>{event.detail}</small></span>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
