import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { createElectionAuditDigest, summarizeElectionResults } from "@/lib/election-results";

export default async function ObserverPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "OBSERVER") redirect("/portal");

  const elections = await prisma.election.findMany({
    where: { status: { in: ["ACTIVE", "CLOSED", "RESULTS_PUBLISHED"] } },
    include: {
      candidates: { orderBy: { sortOrder: "asc" } },
      votes: { select: { candidateId: true } },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return (
    <main className="portal-shell">
      <header className="portal-header">
        <Link className="brand" href="/observer" aria-label="VoteChain observer workspace">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </Link>
        <form action="/api/auth/logout" method="post">
          <button className="portal-signout" type="submit">Sign out</button>
        </form>
      </header>

      <section className="portal-content">
        <p className="eyebrow">OBSERVER / READ-ONLY</p>
        <h1>Election observability</h1>
        <p className="page-subtitle">This view is intentionally read-only and exposes public verification data without voter identities.</p>

        {elections.length === 0 ? (
          <div className="election-empty">
            <strong>No public election activity yet.</strong>
            <span>Active or published elections will appear here once an administrator begins the election lifecycle.</span>
          </div>
        ) : (
          <div className="election-record-list" style={{ marginTop: "2rem" }}>
            {elections.map((election) => {
              const summary = summarizeElectionResults(
                election.candidates.map((candidate) => ({ id: candidate.id, name: candidate.name })),
                election.votes,
              );
              const digest = createElectionAuditDigest({
                electionId: election.id,
                totalVotes: summary.totalVotes,
                candidateResults: summary.candidateResults,
                publishedAt: election.resultsPublishedAt ?? new Date(),
              });

              return (
                <article className="election-record" key={election.id}>
                  <div className="record-heading">
                    <div>
                      <span className="record-id">{election.id}</span>
                      <h3>{election.name}</h3>
                    </div>
                    <span className="election-status status-active"><i />{election.status}</span>
                  </div>

                  <div className="record-metadata">
                    <span><strong>Status:</strong> {election.status}</span>
                    <span><strong>Total votes:</strong> {summary.totalVotes}</span>
                    <span><strong>Winner:</strong> {summary.winner ? `${summary.winner.name} (${summary.winner.voteCount})` : "No votes"}</span>
                    <span><strong>Digest:</strong> {digest.slice(0, 16)}...</span>
                  </div>

                  <div className="record-candidates">
                    {summary.candidateResults.map((candidate) => (
                      <div className="candidate-readonly" key={candidate.candidateId}>
                        <span className="candidate-order">{candidate.voteCount}</span>
                        <span className="candidate-readonly-name">{candidate.name}<small>{candidate.voteCount} votes</small></span>
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
