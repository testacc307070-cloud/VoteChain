import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/database/prisma";
import { getCurrentUser } from "@/backend/auth/session";
import { createElectionAuditDigest, summarizeStoredElectionResults } from "@/verification/results";
import { buildBlockchainSummary, verifyBlockchainChain } from "@/blockchain/blockchain";

export default async function ElectionDetailPage({
  params,
}: {
  params: Promise<{ electionId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { electionId } = await params;
  const election = await prisma.election.findUnique({
    where: { id: electionId },
    include: {
      candidates: { orderBy: { sortOrder: "asc" } },
      votes: {
        select: {
          candidateId: true,
          voterId: true,
          encryptedBallot: true,
          ballotNonce: true,
          ballotAuthTag: true,
          ballotProof: true,
        },
      },
      createdBy: { select: { name: true } },
      blocks: { orderBy: { index: "asc" } },
    },
  });

  if (!election) redirect("/elections");

  const isPublished = election.status === "RESULTS_PUBLISHED";
  const isClosed = election.status === "CLOSED" || isPublished;
  const summary = isClosed ? summarizeStoredElectionResults(
      election.id,
      election.candidates.map((candidate) => ({ id: candidate.id, name: candidate.name })),
      election.votes,
    ) : null;
  const digest = summary ? createElectionAuditDigest({
      electionId: election.id,
      totalVotes: summary.totalVotes,
      candidateResults: summary.candidateResults,
      publishedAt: election.resultsPublishedAt ?? new Date(),
    }) : null;
  const chain = election.blocks.map((block) => ({
    index: block.index,
    timestamp: block.timestamp.getTime(),
    previousHash: block.previousHash,
    payload: block.payload,
    hash: block.hash,
  }));
  const blockchainSummary = buildBlockchainSummary(chain);

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
        <p className="eyebrow">ELECTION DETAIL / VERIFICATION</p>
        <h1>{election.name}</h1>
        <p className="page-subtitle">{election.description || "No description provided."}</p>

        <div className="record-metadata" style={{ marginBottom: "1.5rem" }}>
          <span><strong>Status:</strong> {election.status}</span>
          <span><strong>Started:</strong> {new Date(election.startTime).toISOString().replace("T", " ").slice(0, 16)} UTC</span>
          <span><strong>Ends:</strong> {new Date(election.endTime).toISOString().replace("T", " ").slice(0, 16)} UTC</span>
          <span><strong>Ledger:</strong> {blockchainSummary.blockCount} blocks</span>
          <span><strong>Chain:</strong> {verifyBlockchainChain(chain) ? "VALID" : "INVALID"}</span>
          <span><strong>Head:</strong> {blockchainSummary.headHash.slice(0, 18) || "N/A"}...</span>
        </div>

        {!summary ? (
          <div className="election-empty">
            <strong>Election is still live.</strong>
            <span>Results remain hidden until the election closes and the admin publishes the outcome.</span>
          </div>
        ) : (
          <>
            <div className="portal-status" style={{ marginBottom: "1.5rem" }}>
              <span className="portal-status-mark">✓</span>
              <div>
                <strong>{isPublished ? "Results published" : "Verification window open"}</strong>
                <p>
                  Total votes: {summary.totalVotes}. Winner: {summary.winner ? `${summary.winner.name} (${summary.winner.voteCount})` : "No votes"}. Audit digest: {digest?.slice(0, 28)}...
                </p>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1.5rem" }}>
              <Link href="/results" className="secondary-button" style={{ display: "inline-flex" }}>
                Public results
              </Link>
              <Link href="/audit" className="secondary-button" style={{ display: "inline-flex" }}>
                Audit trail
              </Link>
              <Link href="/verify" className="secondary-button" style={{ display: "inline-flex" }}>
                Receipt verifier
              </Link>
            </div>

            <div className="election-record-list">
              {summary.candidateResults.map((candidate) => (
                <article className="election-record" key={candidate.candidateId}>
                  <div className="record-heading">
                    <div>
                      <span className="record-id">{candidate.candidateId}</span>
                      <h3>{candidate.name}</h3>
                    </div>
                    <span className="election-status status-results_published"><i />{candidate.voteCount} votes</span>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        <div style={{ marginTop: "1.5rem" }}>
          <Link href={user.role === "ADMIN" ? "/elections" : "/portal"} className="secondary-button" style={{ display: "inline-flex" }}>
            Back to {user.role === "ADMIN" ? "elections" : "portal"}
          </Link>
        </div>
      </section>
    </main>
  );
}
