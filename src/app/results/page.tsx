import Link from "next/link";
import { prisma } from "@/database/prisma";
import { getCurrentUser } from "@/backend/auth/session";
import { createElectionAuditDigest, summarizeStoredElectionResults } from "@/verification/results";
import { buildElectionIntegritySnapshot } from "@/verification/merkle";
import { evaluateAuthorityThreshold, reconstructAndValidateElectionKey, stringifyAuthorityStatus } from "@/security/threshold";
import { getElectionEncryptionKey, isLegacyElection } from "@/security/election-keys";
import { buildElectionQrReference } from "@/verification/qr";
import { buildBlockchainSummary, verifyBlockchainChain } from "@/blockchain/blockchain";
import QrCode from "@/frontend/components/qr-code";
import TamperDemo from "@/frontend/components/tamper-demo";

export default async function ResultsPage() {
  const user = await getCurrentUser();

  const elections = await prisma.election.findMany({
    where: { status: { in: ["CLOSED", "RESULTS_PUBLISHED"] } },
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
      blocks: { orderBy: { index: "asc" } },
      authorityApprovals: true,
    },
    orderBy: [{ updatedAt: "desc" }],
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
              <Link href="/audit" prefetch={true} style={{ fontSize: "12px", color: "#64736a", textDecoration: "none" }}>
                Audit Trail
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
        <p className="eyebrow">VERIFICATION / RESULT WINDOW</p>
        <h1>Public integrity dashboard</h1>
        <p className="page-subtitle">
          Election results are published as anonymized totals with a public audit digest, Merkle-based integrity record, and multi-authority threshold verification.
        </p>

        {elections.length === 0 ? (
          <div className="election-empty">
            <strong>No closed or published elections.</strong>
            <span>Published totals will appear here once an election is closed and results are authorized.</span>
          </div>
        ) : (
          <div className="election-record-list" style={{ marginTop: "2rem" }}>
            {elections.map((election) => {
              const threshold = election.requiredAuthorityApprovals ?? 2;
              const authorityStatus = evaluateAuthorityThreshold(
                election.authorityApprovals.map((a) => ({
                  authorityId: a.authorityId,
                  approved: a.approved,
                  keyShare: a.keyShare,
                })),
                threshold,
                election.id,
              );

              let encryptionKeyToUse: string | undefined = undefined;
              if (authorityStatus.canReconstructKey) {
                const submittedShares = election.authorityApprovals
                  .filter((a) => a.approved && a.keyShare && a.keyShare.startsWith("keyshare:"))
                  .map((a) => a.keyShare as string);
                try {
                  encryptionKeyToUse = reconstructAndValidateElectionKey({
                    electionId: election.id,
                    keyCommitment: election.keyCommitment,
                    shares: submittedShares,
                    threshold,
                  });
                } catch {
                  // Key reconstruction failed or tampered
                }
              } else if (isLegacyElection(election)) {
                try {
                  encryptionKeyToUse = getElectionEncryptionKey(election, { purpose: "results_tally" });
                } catch {
                  // Legacy key missing or corrupted
                }
              }

              const isPublished = election.status === "RESULTS_PUBLISHED";
              let summary;
              if (isPublished && encryptionKeyToUse) {
                try {
                  summary = summarizeStoredElectionResults(
                    election.id,
                    election.candidates.map((candidate) => ({ id: candidate.id, name: candidate.name })),
                    election.votes,
                    encryptionKeyToUse,
                  );
                } catch {
                  summary = {
                    totalVotes: election.votes.length,
                    candidateResults: election.candidates.map((candidate) => ({ candidateId: candidate.id, name: candidate.name, voteCount: 0 })),
                    winner: null,
                    isTie: false,
                    resultStatus: "NO_RESULT_NO_VOTES" as const,
                    statusMessage: "No Result — no votes recorded",
                    tiedCandidates: [],
                  };
                }
              } else {
                summary = {
                  totalVotes: election.votes.length,
                  candidateResults: election.candidates.map((candidate) => ({ candidateId: candidate.id, name: candidate.name, voteCount: 0 })),
                  winner: null,
                  isTie: false,
                  resultStatus: "NO_RESULT_NO_VOTES" as const,
                  statusMessage: "No Result — no votes recorded",
                  tiedCandidates: [],
                };
              }

              const digest = createElectionAuditDigest({
                electionId: election.id,
                totalVotes: summary.totalVotes,
                candidateResults: summary.candidateResults,
                publishedAt: election.resultsPublishedAt ?? new Date(),
              });

              const blockChain = election.blocks.map((block) => ({
                index: block.index,
                timestamp: block.timestamp.getTime(),
                previousHash: block.previousHash,
                payload: block.payload,
                hash: block.hash,
              }));

              const blockchainSummary = buildBlockchainSummary(blockChain);
              const integrity = buildElectionIntegritySnapshot({
                electionId: election.id,
                totalVotes: summary.totalVotes,
                validVotes: summary.totalVotes,
                invalidVotes: 0,
                blockHeight: blockchainSummary.blockCount,
              });

              const qrReference = buildElectionQrReference({
                electionId: election.id,
                status: election.status,
                digest: digest,
              });

              const displayName = election.name.replace(/Phase\s+\d+\s*[-:]?\s*/gi, "").trim() || election.name;

              return (
                <article className="election-record" key={election.id}>
                  <div className="record-heading">
                    <div>
                      <span className="record-id">{election.id}</span>
                      <h3>{displayName}</h3>
                    </div>
                    <span className="election-status status-results_published"><i />{election.status}</span>
                  </div>

                  <div className="results-metadata-grid">
                    <div className="results-meta-card">
                      <span className="results-meta-label">Total Votes Cast</span>
                      <strong className="results-meta-value">{summary.totalVotes}</strong>
                    </div>
                    <div className="results-meta-card">
                      <span className="results-meta-label">Winner</span>
                      <strong className="results-meta-value results-meta-winner" style={{ color: isPublished && summary.isTie ? "#b45309" : undefined }}>
                        {isPublished
                          ? summary.isTie
                            ? "No Result — candidates are tied"
                            : summary.winner
                              ? `${summary.winner.name} (${summary.winner.voteCount} votes)`
                              : "No Result — no votes recorded"
                          : "Pending official publication"}
                      </strong>
                    </div>
                    <div className="results-meta-card">
                      <span className="results-meta-label">Result Status</span>
                      <span
                        className={`results-meta-badge ${
                          !isPublished
                            ? "results-badge-warning"
                            : summary.isTie
                              ? "results-badge-warning"
                              : summary.winner
                                ? "results-badge-success"
                                : "results-badge-warning"
                        }`}
                        style={{
                          backgroundColor: isPublished && summary.isTie ? "#fef3c7" : undefined,
                          color: isPublished && summary.isTie ? "#92400e" : undefined,
                          borderColor: isPublished && summary.isTie ? "#fde68a" : undefined,
                        }}
                      >
                        {isPublished
                          ? summary.isTie
                            ? "NO RESULT (TIED)"
                            : summary.winner
                              ? "WINNER DECLARED"
                              : "NO RESULT"
                          : "IN PROGRESS"}
                      </span>
                    </div>
                    <div className="results-meta-card">
                      <span className="results-meta-label">Audit Digest</span>
                      <code className="results-meta-mono">{digest.slice(0, 24)}...</code>
                    </div>
                    <div className="results-meta-card">
                      <span className="results-meta-label">Integrity Status</span>
                      <span className="results-meta-badge results-badge-success">{integrity.status}</span>
                    </div>
                    <div className="results-meta-card">
                      <span className="results-meta-label">Merkle Root</span>
                      <code className="results-meta-mono">{integrity.merkleRoot.slice(0, 24)}...</code>
                    </div>
                    <div className="results-meta-card">
                      <span className="results-meta-label">Block Height</span>
                      <strong className="results-meta-value">{integrity.blockHeight} blocks</strong>
                    </div>
                    <div className="results-meta-card">
                      <span className="results-meta-label">Ledger Validation</span>
                      <span className={`results-meta-badge ${verifyBlockchainChain(blockChain) ? "results-badge-success" : "results-badge-error"}`}>
                        {verifyBlockchainChain(blockChain) ? "CHAIN VALID" : "INVALID"}
                      </span>
                    </div>
                    <div className="results-meta-card">
                      <span className="results-meta-label">Head Block Hash</span>
                      <code className="results-meta-mono">{blockchainSummary.headHash.slice(0, 20)}...</code>
                    </div>
                    <div className="results-meta-card">
                      <span className="results-meta-label">Authority Threshold</span>
                      <strong className="results-meta-value">{stringifyAuthorityStatus(authorityStatus)}</strong>
                    </div>
                    <div className="results-meta-card">
                      <span className="results-meta-label">Verification Ref</span>
                      <code className="results-meta-mono">{qrReference.slice(0, 24)}...</code>
                    </div>
                  </div>

                  <div style={{ marginTop: "1.5rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                      <strong style={{ fontSize: "12px", color: "#37453d" }}>
                        {isPublished ? "Candidate Results" : "Candidate Roster"}
                      </strong>
                      <span style={{ fontSize: "10px", color: "#85938a" }}>
                        {isPublished ? `${summary.totalVotes} total verified votes` : "Tally withheld until publication"}
                      </span>
                    </div>
                    {!isPublished ? (
                      <div className="portal-status" style={{ marginTop: "0.5rem" }}>
                        <span className="portal-status-mark">⏳</span>
                        <div>
                          <strong>Election Closed · Multi-Authority Custody</strong>
                          <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#64748b" }}>
                            In compliance with secret ballot principles, candidate vote totals remain encrypted until 2-of-3 threshold authority key reconstruction is finalized and officially authorized for publication by the administrator.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="record-candidates">
                        {summary.isTie && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "10px 14px",
                              backgroundColor: "#fffbeb",
                              border: "1px solid #fde68a",
                              borderRadius: 6,
                              marginBottom: 10,
                              color: "#92400e",
                              fontSize: "12px",
                            }}
                          >
                            <span style={{ fontSize: "16px" }}>⚖️</span>
                            <div>
                              <strong>Result: No Result — candidates are tied.</strong> Two or more candidates shared the highest vote count ({summary.tiedCandidates.map((c) => c.name).join(", ")} with {summary.tiedCandidates[0]?.voteCount} votes each). No unique winner is declared.
                            </div>
                          </div>
                        )}
                        {summary.candidateResults.map((candidate) => {
                          const pct = summary.totalVotes > 0 ? Math.round((candidate.voteCount / summary.totalVotes) * 100) : 0;
                          return (
                            <div className="candidate-tally-row" key={candidate.candidateId}>
                              <div className="candidate-tally-info">
                                <span className="candidate-tally-name">{candidate.name}</span>
                                <span className="candidate-tally-count">
                                  <strong>{candidate.voteCount}</strong> votes ({pct}%)
                                </span>
                              </div>
                              <div className="candidate-tally-bar-bg">
                                <div className="candidate-tally-bar-fill" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="results-verification-section">
                    <div className="results-qr-card">
                      <div className="qr-container">
                        <QrCode value={qrReference} />
                      </div>
                      <div className="qr-info">
                        <h4>Public Verification QR Code</h4>
                        <p>Scan with any mobile device or camera to verify zero-knowledge ballot inclusion and Merkle tree root commitments.</p>
                        <div className="qr-ref-box">
                          <code>{qrReference}</code>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Interactive Tamper Demonstration */}
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
      </section>
    </main>
  );
}
