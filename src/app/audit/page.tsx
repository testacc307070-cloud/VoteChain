import Link from "next/link";
import { prisma } from "@/database/prisma";
import { getCurrentUser } from "@/backend/auth/session";
import { buildElectionAuditTrail } from "@/verification/audit";
import TamperDemo from "@/frontend/components/tamper-demo";
import { FileText, ShieldCheck } from "lucide-react";

export default async function AuditPage() {
  const user = await getCurrentUser();

  const elections = await prisma.election.findMany({
    where: { status: { in: ["ACTIVE", "CLOSED", "RESULTS_PUBLISHED"] } },
    include: {
      candidates: true,
      votes: { select: { id: true } },
      blocks: { orderBy: { index: "asc" } },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  const dbAuditLogs = await prisma.auditLog.findMany({
    take: 20,
    orderBy: { timestamp: "desc" },
  });

  return (
    <main className="portal-shell">
      <header className="portal-header">
        <Link className="brand" href={user ? (user.role === "ADMIN" ? "/" : "/portal") : "/login"} aria-label="VoteChain home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </Link>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          {user?.role === "ADMIN" && (
            <nav style={{ display: "flex", gap: "14px", alignItems: "center", marginRight: "0.5rem" }}>
              <Link href="/" prefetch={true} style={{ fontSize: "12px", color: "#64736a", textDecoration: "none" }}>
                Overview
              </Link>
              <Link href="/elections" prefetch={true} style={{ fontSize: "12px", color: "#64736a", textDecoration: "none" }}>
                Elections
              </Link>
              <Link href="/results" prefetch={true} style={{ fontSize: "12px", color: "#64736a", textDecoration: "none" }}>
                Ledger
              </Link>
            </nav>
          )}
          {user ? (
            <form action="/api/auth/logout" method="post">
              <button className="portal-signout" type="submit">Sign out</button>
            </form>
          ) : (
            <Link href="/login" className="secondary-button" style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}>
              Sign in
            </Link>
          )}
        </div>
      </header>

      <section className="portal-content">
        <p className="eyebrow">AUDIT & INTEGRITY REVIEW</p>
        <h1>Election audit trail & event log</h1>
        <p className="page-subtitle">
          Lifecycle and administrative operations are recorded in an append-oriented, cryptographically hashed event stream without disclosing voter identities.
        </p>

        {elections.length === 0 ? (
          <div className="election-empty">
            <strong>No active or completed elections yet.</strong>
            <span>Audit trails appear here as soon as an election begins its lifecycle.</span>
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
                    <span className={`election-status status-${election.status.toLowerCase()}`}>
                      <i />{election.status}
                    </span>
                  </div>

                  <div className="record-candidates" style={{ marginTop: "1rem" }}>
                    {trail.map((event) => (
                      <div className="candidate-readonly" key={`${election.id}-${event.title}`}>
                        <span className="candidate-order">{event.tag}</span>
                        <span className="candidate-readonly-name">{event.title}<small>{event.detail}</small></span>
                      </div>
                    ))}
                  </div>

                  {election.blocks.length > 0 && (
                    <TamperDemo
                      blocks={election.blocks.map((b) => ({
                        index: b.index,
                        hash: b.hash,
                        previousHash: b.previousHash,
                        payload: b.payload,
                        timestamp: b.timestamp.toISOString(),
                      }))}
                    />
                  )}
                </article>
              );
            })}
          </div>
        )}

        {/* Persisted Audit Log Table */}
        <section style={{ marginTop: "3rem" }}>
          <div className="section-heading">
            <div>
              <h2>Cryptographic System Log</h2>
              <p>Append-oriented SHA-256 event commitments for administrative actions and ballot ingest.</p>
            </div>
          </div>

          <div className="election-record" style={{ marginTop: "1rem" }}>
            {dbAuditLogs.length === 0 ? (
              <div style={{ padding: "1rem", color: "var(--muted, #888)" }}>No audit records in database yet.</div>
            ) : (
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {dbAuditLogs.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "1rem",
                      padding: "12px 16px",
                      background: "#ffffff",
                      border: "1px solid #edf0ec",
                      borderRadius: "6px",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
                        <FileText size={15} color="#347c5b" />
                        <strong style={{ fontSize: "12px", color: "#25332d" }}>{log.eventType}</strong>
                        <span style={{ fontSize: "11px", color: "#84938a", fontFamily: "var(--font-data)" }}>
                          Actor: {log.actorReference}
                        </span>
                      </div>
                      {log.details && (
                        <p style={{ margin: "0.4rem 0 0 0", fontSize: "11px", color: "#66776e", lineHeight: 1.5, wordBreak: "break-word" }}>
                          {log.details}
                        </p>
                      )}
                    </div>
                    <div style={{ textAlign: "right", fontSize: "10px", color: "#88968e", flexShrink: 0 }}>
                      <div style={{ fontWeight: 500 }}>{new Date(log.timestamp).toLocaleTimeString()}</div>
                      <code style={{ fontSize: "9px", color: "#54645b" }}>{log.eventHash.slice(0, 16)}...</code>
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
