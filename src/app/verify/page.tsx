import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { verifyVoteReceipt } from "@/lib/voting";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = (await searchParams) ?? {};
  const electionId = typeof params.electionId === "string" ? params.electionId : "";
  const voteId = typeof params.voteId === "string" ? params.voteId : "";
  const candidateId = typeof params.candidateId === "string" ? params.candidateId : "";
  const submittedAt = typeof params.submittedAt === "string" ? params.submittedAt : "";
  const recordHash = typeof params.recordHash === "string" ? params.recordHash : "";

  let proofStatus = "No receipt supplied";
  let verified = false;

  if (electionId && voteId && candidateId && submittedAt && recordHash) {
    verified = verifyVoteReceipt({
      electionId,
      voteId,
      candidateId,
      submittedAt: new Date(submittedAt),
      recordHash,
    });
    proofStatus = verified ? "Receipt verified" : "Receipt mismatch";
  }

  const vote = voteId ? await prisma.electionVote.findUnique({
    where: { id: voteId },
    select: { id: true, electionId: true, receiptId: true, txHash: true, blockNumber: true, submittedAt: true },
  }) : null;

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
        <p className="eyebrow">VOTE VERIFICATION</p>
        <h1>Receipt proof</h1>
        <p className="page-subtitle">A receipt proves that a valid ballot was accepted without revealing the candidate choice.</p>

        <div className="portal-status" style={{ marginTop: "1.5rem" }}>
          <span className="portal-status-mark">{verified ? "✓" : "i"}</span>
          <div>
            <strong>{proofStatus}</strong>
            <p>{verified ? "The submitted ballot matches the recorded receipt metadata and hash." : "Add a valid electionId, voteId, candidateId, submittedAt, and recordHash to verify a ballot."}</p>
          </div>
        </div>

        {vote ? (
          <div className="election-record" style={{ marginTop: "1.5rem" }}>
            <div className="record-heading">
              <div>
                <span className="record-id">{vote.id}</span>
                <h3>Recorded vote transaction</h3>
              </div>
              <span className="election-status status-results_published"><i />{vote.receiptId}</span>
            </div>
            <div className="record-metadata">
              <span><strong>Election:</strong> {vote.electionId}</span>
              <span><strong>Tx:</strong> {vote.txHash}</span>
              <span><strong>Block:</strong> {vote.blockNumber}</span>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
