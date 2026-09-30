import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { createElectionAuditDigest, summarizeStoredElectionResults } from "@/lib/election-results";
import { buildElectionIntegritySnapshot } from "@/lib/integrity";
import { evaluateAuthorityThreshold, reconstructAndValidateElectionKey, stringifyAuthorityStatus } from "@/lib/authority";
import { getElectionEncryptionKey, isLegacyElection } from "@/lib/election-keys";
import { buildElectionQrReference } from "@/lib/qr";
import { buildBlockchainSummary, verifyBlockchainChain } from "@/lib/blockchain";
import QrCode from "@/components/qr-code";
import TamperDemo from "@/components/tamper-demo";

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

              let summary;
              if (encryptionKeyToUse) {
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
                  };
                }
              } else {
                summary = {
                  totalVotes: election.votes.length,
                  candidateResults: election.candidates.map((candidate) => ({ candidateId: candidate.id, name: candidate.name, voteCount: 0 })),
                  winner: null,
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
                    <span><strong>Digest:</strong> {digest.slice(0, 24)}...</span>
                    <span><strong>Status:</strong> {integrity.status}</span>
                    <span><strong>Merkle root:</strong> {integrity.merkleRoot.slice(0, 24)}...</span>
                    <span><strong>Block height:</strong> {integrity.blockHeight}</span>
                    <span><strong>Ledger valid:</strong> {verifyBlockchainChain(blockChain) ? "VALID" : "INVALID"}</span>
                    <span><strong>Head hash:</strong> {blockchainSummary.headHash.slice(0, 18)}...</span>
                    <span><strong>Authority threshold:</strong> {stringifyAuthorityStatus(authorityStatus)}</span>
                    <span><strong>QR ref:</strong> {qrReference.slice(0, 28)}...</span>
                  </div>

                  <div className="record-candidates" style={{ marginTop: "1rem" }}>
                    {summary.candidateResults.map((candidate) => (
                      <div className="candidate-readonly" key={candidate.candidateId}>
                        <span className="candidate-order">{candidate.voteCount}</span>
                        <span className="candidate-readonly-name">{candidate.name}<small>{candidate.voteCount} votes</small></span>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
                    <div className="candidate-readonly" style={{ alignItems: "center" }}>
                      <span className="candidate-order">QR</span>
                      <span className="candidate-readonly-name"><QrCode value={qrReference} /><small>Scan to open public verification</small></span>
                    </div>
                    <div className="candidate-readonly">
                      <span className="candidate-order">REF</span>
                      <span className="candidate-readonly-name">Election verification reference<small>{qrReference}</small></span>
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
