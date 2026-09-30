import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { evaluateAuthorityThreshold, reconstructAndValidateElectionKey, stringifyAuthorityStatus } from "@/lib/authority";
import { createElectionAuditDigest, summarizeStoredElectionResults } from "@/lib/election-results";
import { getElectionEncryptionKey } from "@/lib/election-keys";
import { KeyRound, ShieldCheck, CheckCircle2, Clock, AlertTriangle } from "lucide-react";

export default async function AuthorityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "AUTHORITY" && user.role !== "ADMIN") redirect("/portal");

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
      authorityApprovals: { orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  const allAuthorities = await prisma.user.findMany({
    where: { role: "AUTHORITY" },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="portal-shell">
      <header className="portal-header">
        <Link className="brand" href="/authority" aria-label="VoteChain authority workspace">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </Link>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--muted, #888)" }}>
            Trustee Account: {user.name} ({user.email})
          </span>
          <form action="/api/auth/logout" method="post">
            <button className="portal-signout" type="submit">Sign out</button>
          </form>
        </div>
      </header>

      <section className="portal-content">
        <p className="eyebrow">MULTI-PARTY TRUSTEE WORKSPACE · THRESHOLD CONTROL</p>
        <h1>Election authority validation</h1>
        <p className="page-subtitle">
          VoteChain distributes sensitive tally decryption across multiple trusted authorities using Shamir&apos;s Secret Sharing. Ballots cannot be decrypted until the cryptographic threshold of key shares is submitted.
        </p>

        {elections.length === 0 ? (
          <div className="election-empty">
            <strong>No closed elections awaiting authority review.</strong>
            <span>When an active election reaches its scheduled closing time, it will appear here for threshold approval.</span>
          </div>
        ) : (
          <div className="election-record-list" style={{ marginTop: "2rem" }}>
            {elections.map((election) => {
              const threshold = election.requiredAuthorityApprovals ?? 2;
              const authorityStatus = evaluateAuthorityThreshold(
                election.authorityApprovals.map((approval) => ({
                  authorityId: approval.authorityId,
                  approved: approval.approved,
                  keyShare: approval.keyShare,
                })),
                threshold,
              );

              const currentApproval = election.authorityApprovals.find((a) => a.authorityId === user.id);
              const hasCurrentApproved = currentApproval?.approved === true;

              let summary = null;
              if (authorityStatus.canReconstructKey || election.status === "RESULTS_PUBLISHED") {
                try {
                  const submittedShares = election.authorityApprovals
                    .filter((a) => a.approved && a.keyShare && a.keyShare.startsWith("keyshare:"))
                    .map((a) => a.keyShare as string);

                  const keyToUse =
                    submittedShares.length >= threshold
                      ? reconstructAndValidateElectionKey({
                          electionId: election.id,
                          keyCommitment: election.keyCommitment,
                          shares: submittedShares,
                          threshold,
                        })
                      : getElectionEncryptionKey(election);

                  summary = summarizeStoredElectionResults(
                    election.id,
                    election.candidates.map((c) => ({ id: c.id, name: c.name })),
                    election.votes,
                    keyToUse,
                  );
                } catch {
                  // key reconstruction in progress or tampered
                }
              }

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

                  {/* Threshold Cryptography Status Banner */}
                  <div
                    className="portal-status"
                    style={{
                      marginTop: "1rem",
                      borderLeft: `4px solid ${authorityStatus.canReconstructKey ? "#10b981" : "#f59e0b"}`,
                    }}
                  >
                    <KeyRound size={20} color={authorityStatus.canReconstructKey ? "#10b981" : "#f59e0b"} />
                    <div>
                      <strong>
                        {authorityStatus.canReconstructKey
                          ? "Decryption Threshold Satisfied"
                          : `Threshold Pending (${authorityStatus.sharesSubmitted}/${authorityStatus.required} Shares Submitted)`}
                      </strong>
                      <p style={{ margin: "0.25rem 0", fontSize: "0.85rem" }}>
                        {authorityStatus.canReconstructKey
                          ? "The required threshold of key shares has been submitted. The election master decryption key is reconstructed and tallying is authorized."
                          : `Ballots remain cryptographically encrypted. At least ${authorityStatus.required} authority members must approve to reconstruct the decryption key.`}
                      </p>
                    </div>
                  </div>

                  {/* Registered Authority Share Status Table */}
                  <div style={{ marginTop: "1rem" }}>
                    <strong style={{ fontSize: "0.85rem" }}>Authority Trustee Sign-off Status:</strong>
                    <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem" }}>
                      {allAuthorities.map((auth, index) => {
                        const approval = election.authorityApprovals.find((a) => a.authorityId === auth.id);
                        const isApproved = approval?.approved === true;
                        const hasShare = Boolean(approval?.keyShare);

                        return (
                          <div
                            key={auth.id}
                            className="candidate-readonly"
                            style={{ justifyContent: "space-between", padding: "0.5rem 0.75rem" }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span className="candidate-order">#{index + 1}</span>
                              <span className="candidate-readonly-name">
                                {auth.name} <small>({auth.email})</small>
                              </span>
                            </div>
                            <span
                              style={{
                                fontSize: "0.8rem",
                                display: "flex",
                                alignItems: "center",
                                gap: "0.3rem",
                                color: isApproved ? "#10b981" : "#f59e0b",
                              }}
                            >
                              {isApproved ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                              {isApproved ? `Approved ${hasShare ? "(Key Share Attached)" : ""}` : "Pending Review"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Action Forms for Logged-In Authority */}
                  <div style={{ marginTop: "1.5rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
                    <form action={`/api/authority/elections/${election.id}/approval`} method="post">
                      <input type="hidden" name="approved" value="true" />
                      <button
                        type="submit"
                        className="primary-button"
                        disabled={hasCurrentApproved}
                        style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
                      >
                        <KeyRound size={15} />
                        {hasCurrentApproved ? "Your Key Share is Submitted" : "Approve & Submit Key Share"}
                      </button>
                    </form>

                    <form action={`/api/authority/elections/${election.id}/approval`} method="post">
                      <input type="hidden" name="approved" value="false" />
                      <button type="submit" className="secondary-button" disabled={hasCurrentApproved}>
                        Flag Election for Audit
                      </button>
                    </form>
                  </div>

                  {/* Results Summary if Tally is Decrypted */}
                  {summary && (
                    <div style={{ marginTop: "1.5rem" }}>
                      <strong>Reconstructed Election Tally:</strong>
                      <div className="record-candidates" style={{ marginTop: "0.5rem" }}>
                        {summary.candidateResults.map((candidate) => (
                          <div className="candidate-readonly" key={candidate.candidateId}>
                            <span className="candidate-order">{candidate.voteCount}</span>
                            <span className="candidate-readonly-name">
                              {candidate.name}
                              <small>{candidate.voteCount} votes · Winner: {summary?.winner?.candidateId === candidate.candidateId ? "YES" : "NO"}</small>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
