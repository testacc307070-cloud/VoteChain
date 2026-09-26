import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { evaluateAuthorityThreshold, stringifyAuthorityStatus } from "@/lib/authority";
import { createElectionAuditDigest, summarizeElectionResults } from "@/lib/election-results";

export default async function AuthorityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "AUTHORITY") redirect("/portal");

  const elections = await prisma.election.findMany({
    where: { status: { in: ["CLOSED", "RESULTS_PUBLISHED"] } },
    include: {
      candidates: { orderBy: { sortOrder: "asc" } },
      votes: { select: { candidateId: true } },
      authorityApprovals: { orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return (
    <main className="portal-shell">
      <header className="portal-header">
        <Link className="brand" href="/authority" aria-label="VoteChain authority workspace">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </Link>
        <form action="/api/auth/logout" method="post">
          <button className="portal-signout" type="submit">Sign out</button>
        </form>
      </header>

      <section className="portal-content">
        <p className="eyebrow">AUTHORITY / THRESHOLD REVIEW</p>
        <h1>Authority validation</h1>
        <p className="page-subtitle">Authority members validate the public tally and approving thresholds before publication is considered complete.</p>

        {elections.length === 0 ? (
          <div className="election-empty">
            <strong>No published election review is available.</strong>
            <span>Closed elections appear here when the tally is ready for authority approval.</span>
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
              const authorityStatus = evaluateAuthorityThreshold(
                election.authorityApprovals.map((approval) => ({
                  authorityId: approval.authorityId,
                  approved: approval.approved,
                })),
                3,
              );
              const hasCurrentApproval = election.authorityApprovals.some((approval) => approval.authorityId === user.id);

              return (
                <article className="election-record" key={election.id}>
                  <div className="record-heading">
                    <div>
                      <span className="record-id">{election.id}</span>
                      <h3>{election.name}</h3>
                    </div>
                    <span className="election-status status-results_published"><i />{election.status}</span>
                  </div>

                  <div className="record-metadata">
                    <span><strong>Total votes:</strong> {summary.totalVotes}</span>
                    <span><strong>Winner:</strong> {summary.winner ? `${summary.winner.name} (${summary.winner.voteCount})` : "No votes"}</span>
                    <span><strong>Digest:</strong> {digest.slice(0, 28)}...</span>
                    <span><strong>Approval:</strong> {stringifyAuthorityStatus(authorityStatus)}</span>
                  </div>

                  <div className="record-candidates">
                    {summary.candidateResults.map((candidate) => (
                      <div className="candidate-readonly" key={candidate.candidateId}>
                        <span className="candidate-order">{candidate.voteCount}</span>
                        <span className="candidate-readonly-name">{candidate.name}<small>{candidate.voteCount} votes</small></span>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
                    <form action={`/api/authority/elections/${election.id}/approval`} method="post">
                      <input type="hidden" name="approved" value="true" />
                      <button type="submit" className="primary-button" disabled={hasCurrentApproval}>
                        {hasCurrentApproval ? "Approval recorded" : "Approve results"}
                      </button>
                    </form>
                    <form action={`/api/authority/elections/${election.id}/approval`} method="post">
                      <input type="hidden" name="approved" value="false" />
                      <button type="submit" className="secondary-button" disabled={hasCurrentApproval}>
                        Flag for review
                      </button>
                    </form>
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
