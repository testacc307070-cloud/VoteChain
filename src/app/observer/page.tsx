import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { createElectionAuditDigest, summarizeStoredElectionResults } from "@/lib/election-results";
import { buildBlockchainSummary, verifyBlockchainChain } from "@/lib/blockchain";
import { buildElectionIntegritySnapshot } from "@/lib/integrity";
import TamperDemo from "@/components/tamper-demo";
import { ShieldCheck, Eye, Lock, FileText, CheckCircle2 } from "lucide-react";

export default async function ObserverPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "OBSERVER" && user.role !== "ADMIN") redirect("/portal");

  const elections = await prisma.election.findMany({
    where: { status: { in: ["ACTIVE", "CLOSED", "RESULTS_PUBLISHED"] } },
    include: {
      candidates: { orderBy: { sortOrder: "asc" } },
      votes: {
        select: {
          id: true,
          candidateId: true,
          voterId: true,
          encryptedBallot: true,
          ballotNonce: true,
          ballotAuthTag: true,
          ballotProof: true,
          zkProof: true,
          txHash: true,
          blockNumber: true,
          submittedAt: true,
        },
      },
      blocks: { orderBy: { index: "asc" } },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  const recentAuditLogs = await prisma.auditLog.findMany({
    take: 10,
    orderBy: { timestamp: "desc" },
  });

  return (
    <main className="portal-shell">
      <header className="portal-header">
        <Link className="brand" href="/observer" aria-label="VoteChain observer workspace">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </Link>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--muted, #888)" }}>
            Observer Mode: {user.name} ({user.email})
          </span>
          <form action="/api/auth/logout" method="post">
            <button className="portal-signout" type="submit">Sign out</button>
          </form>
        </div>
      </header>

      <section className="portal-content">
        <p className="eyebrow">INDEPENDENT OBSERVER WORKSPACE · READ-ONLY</p>
        <h1>Election observability & audit monitor</h1>
        <p className="page-subtitle">
          Independent verification portal for election observers. Inspect blockchain health, candidate locking status, transaction commitments, and audit event logs without compromising secret ballots.
        </p>

        {elections.length === 0 ? (
          <div className="election-empty">
            <strong>No active or published elections to inspect.</strong>
            <span>Active or published elections will appear here once an administrator begins the election lifecycle.</span>
          </div>
        ) : (
          <div className="election-record-list" style={{ marginTop: "2rem" }}>
            {elections.map((election) => {
              const chain = election.blocks.map((block) => ({
                index: block.index,
                timestamp: block.timestamp.getTime(),
                previousHash: block.previousHash,
                payload: block.payload,
                hash: block.hash,
              }));

              const blockchainSummary = buildBlockchainSummary(chain);
              const isLedgerValid = verifyBlockchainChain(chain);

              const summary =
                election.status === "ACTIVE"
                  ? null
                  : summarizeStoredElectionResults(
                      election.id,
                      election.candidates.map((candidate) => ({ id: candidate.id, name: candidate.name })),
                      election.votes,
                    );

              const digest = summary
                ? createElectionAuditDigest({
                    electionId: election.id,
                    totalVotes: summary.totalVotes,
                    candidateResults: summary.candidateResults,
                    publishedAt: election.resultsPublishedAt ?? new Date(),
                  })
                : null;

              const integrity = buildElectionIntegritySnapshot({
                electionId: election.id,
                totalVotes: election.votes.length,
                validVotes: election.votes.length,
                invalidVotes: 0,
                blockHeight: blockchainSummary.blockCount,
              });

              return (
                <article className="election-record" key={election.id}>
                  <div className="record-heading">
                    <div>
                      <span className="record-id">{election.id}</span>
                      <h3>{election.name}</h3>
                      {election.description && <p className="record-description">{election.description}</p>}
                    </div>
                    <span className={`election-status status-${election.status.toLowerCase()}`}>
                      <i />{election.status}
                    </span>
                  </div>

                  {/* Observer Verification Grid */}
                  <div className="record-metadata" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted, #888)" }}>BLOCKCHAIN INTEGRITY</div>
                      <strong style={{ color: isLedgerValid ? "#10b981" : "#ef4444", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                        <ShieldCheck size={15} /> {isLedgerValid ? "VALID / VERIFIED" : "INTEGRITY ERROR"}
                      </strong>
                    </div>

                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted, #888)" }}>CANDIDATE LOCK STATUS</div>
                      <strong style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                        <Lock size={15} /> {election.candidatesLocked ? "LOCKED & IMMUTABLE" : "UNLOCKED (DRAFT)"}
                      </strong>
                    </div>

                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted, #888)" }}>RECORDED COMMITMENTS</div>
                      <strong>{election.votes.length} Votes ({blockchainSummary.blockCount} Blocks)</strong>
                    </div>

                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted, #888)" }}>MERKLE ROOT</div>
                      <code style={{ fontSize: "0.75rem" }}>{integrity.merkleRoot.slice(0, 18)}...</code>
                    </div>
                  </div>

                  {/* Results Section */}
                  {summary ? (
                    <div style={{ marginTop: "1.5rem" }}>
                      <strong>Published Results & Tallies</strong>
                      <div className="record-candidates" style={{ marginTop: "0.5rem" }}>
                        {summary.candidateResults.map((candidate) => (
                          <div className="candidate-readonly" key={candidate.candidateId}>
                            <span className="candidate-order">{candidate.voteCount}</span>
                            <span className="candidate-readonly-name">
                              {candidate.name}
                              <small>{candidate.voteCount} votes · Winner: {summary.winner?.candidateId === candidate.candidateId ? "YES" : "NO"}</small>
                            </span>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--muted, #888)" }}>
                        Public Audit Digest: <code>{digest}</code>
                      </div>
                    </div>
                  ) : (
                    <div className="portal-status" style={{ marginTop: "1.5rem" }}>
                      <Eye size={18} color="#38bdf8" />
                      <div>
                        <strong>Interim Candidate Totals Withheld</strong>
                        <p style={{ margin: 0, fontSize: "0.85rem" }}>
                          In compliance with secret ballot principles, interim vote counts are not disclosed during active voting to prevent voter influence.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Controlled Tamper Demonstration */}
                  <TamperDemo
                    blocks={election.blocks.map((b) => ({
                      index: b.index,
                      hash: b.hash,
                      previousHash: b.previousHash,
                      payload: b.payload,
                      timestamp: b.timestamp.toISOString(),
                    }))}
                  />
                </article>
              );
            })}
          </div>
        )}

        {/* Append-Oriented System Audit Stream */}
        <section style={{ marginTop: "3rem" }}>
          <div className="section-heading">
            <div>
              <h2>System Audit Log Stream</h2>
              <p>Cryptographically hashed append-oriented audit records of all security-sensitive actions.</p>
            </div>
          </div>

          <div className="election-record" style={{ marginTop: "1rem" }}>
            {recentAuditLogs.length === 0 ? (
              <div style={{ padding: "1rem", color: "var(--muted, #888)" }}>No audit events logged yet.</div>
            ) : (
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {recentAuditLogs.map((log) => (
                  <div key={log.id} className="candidate-readonly" style={{ justifyContent: "space-between" }}>
                    <div>
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        <FileText size={14} color="#38bdf8" />
                        <strong style={{ fontSize: "0.85rem" }}>{log.eventType}</strong>
                        <span style={{ fontSize: "0.75rem", color: "var(--muted, #888)" }}>by {log.actorReference}</span>
                      </div>
                      <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.8rem" }}>{log.details}</p>
                    </div>
                    <div style={{ textAlign: "right", fontSize: "0.75rem", color: "var(--muted, #888)" }}>
                      <div>{new Date(log.timestamp).toLocaleTimeString()}</div>
                      <code>{log.eventHash.slice(0, 12)}...</code>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
