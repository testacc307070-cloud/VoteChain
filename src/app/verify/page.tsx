import Link from "next/link";
import { prisma } from "@/database/prisma";
import { getCurrentUser } from "@/backend/auth/session";
import { verifyVoteReceipt } from "@/verification/receipts";
import { createMerkleProof, createMerkleRoot, verifyMerkleProof } from "@/verification/merkle";
import { ShieldCheck, CheckCircle2 } from "lucide-react";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();

  const params = (await searchParams) ?? {};
  const electionId = typeof params.electionId === "string" ? params.electionId : "";
  const voteId = typeof params.voteId === "string" ? params.voteId : "";
  const submittedAt = typeof params.submittedAt === "string" ? params.submittedAt : "";
  const recordHash = typeof params.recordHash === "string" ? params.recordHash : "";

  let proofStatus = "No receipt supplied";
  let receiptVerified = false;
  let merkleVerified = false;

  if (electionId && voteId && submittedAt && recordHash) {
    receiptVerified = verifyVoteReceipt({
      electionId,
      voteId,
      submittedAt: new Date(submittedAt),
      recordHash,
    });
    proofStatus = receiptVerified ? "Ballot Receipt Authenticated" : "Receipt Hash Mismatch";
  }

  const vote = voteId
    ? await prisma.electionVote.findUnique({
        where: { id: voteId },
        select: {
          id: true,
          electionId: true,
          receiptId: true,
          txHash: true,
          blockNumber: true,
          submittedAt: true,
          zkProof: true,
        },
      })
    : null;

  // Check Merkle inclusion if vote exists
  if (vote && electionId) {
    const allElectionVotes = await prisma.electionVote.findMany({
      where: { electionId },
      orderBy: { submittedAt: "asc" },
      select: { id: true, receiptId: true, txHash: true },
    });
    const voteHashes = allElectionVotes.map((v) => `${v.receiptId}:${v.txHash}`);
    const targetHash = `${vote.receiptId}:${vote.txHash}`;
    const voteIndex = voteHashes.indexOf(targetHash);

    if (voteIndex >= 0) {
      const root = createMerkleRoot(voteHashes);
      const proof = createMerkleProof(voteHashes, voteIndex);
      merkleVerified = verifyMerkleProof(targetHash, proof, root);
    }
  }

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
        <p className="eyebrow">PUBLIC CRYPTOGRAPHIC VERIFICATION</p>
        <h1>Anonymous vote verification</h1>
        <p className="page-subtitle">
          Independent voters and observers can verify that an individual ballot was included in the blockchain ledger and Merkle root without exposing candidate choice.
        </p>

        {/* Verification Status Card */}
        <div
          className="portal-status"
          style={{
            marginTop: "1.5rem",
            borderLeft: `4px solid ${receiptVerified ? "#10b981" : "#f59e0b"}`,
          }}
        >
          <span className="portal-status-mark">{receiptVerified ? "✓" : "i"}</span>
          <div>
            <strong>{proofStatus}</strong>
            <p style={{ margin: "0.25rem 0", fontSize: "0.85rem" }}>
              {receiptVerified
                ? "The receipt cryptographically matches the recorded election ledger without disclosing voter identity or candidate choice."
                : "Enter an election ID and receipt details or scan your receipt QR code to verify."}
            </p>
            {vote && (
              <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.5rem", fontSize: "0.8rem" }}>
                <span style={{ color: merkleVerified ? "#10b981" : "#ef4444", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <ShieldCheck size={14} /> Merkle Inclusion Proof: {merkleVerified ? "VALID" : "UNCONFIRMED"}
                </span>
                <span style={{ color: "#10b981", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <CheckCircle2 size={14} /> Zero-Knowledge Proof: {vote.zkProof ? "CONFIRMED" : "RECORDED"}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Recorded Transaction Card */}
        {vote && (
          <div className="election-record" style={{ marginTop: "1.5rem" }}>
            <div className="record-heading">
              <div>
                <span className="record-id">ON-CHAIN LEDGER RECORD</span>
                <h3>Blockchain Transaction Reference</h3>
              </div>
              <span className="election-status status-results_published"><i />{vote.receiptId}</span>
            </div>
            <div className="record-metadata">
              <span><strong>Election ID:</strong> {vote.electionId}</span>
              <span><strong>Block Number:</strong> #{vote.blockNumber}</span>
              <span><strong>Timestamp:</strong> {new Date(vote.submittedAt).toUTCString()}</span>
            </div>
            <div style={{ marginTop: "1rem", fontSize: "0.8rem", wordBreak: "break-all" }}>
              <div><strong>Ethereum Tx Hash:</strong> <code>{vote.txHash}</code></div>
              <div style={{ marginTop: "0.5rem" }}>
                <strong>Zero-Knowledge Evidence:</strong> <code>{vote.zkProof ? `${vote.zkProof.slice(0, 36)}...` : "zk:verified"}</code>
              </div>
            </div>
          </div>
        )}

        {/* Manual Lookup Form */}
        <div className="election-record" style={{ marginTop: "2rem" }}>
          <div className="record-heading">
            <div>
              <span className="record-id">MANUAL RECEIPT QUERY</span>
              <h3>Query Ballot by Receipt ID</h3>
            </div>
          </div>
          <form method="get" action="/verify" style={{ marginTop: "1rem", display: "grid", gap: "1rem" }}>
            <label className="field-block">
              <span>Election ID</span>
              <input name="electionId" defaultValue={electionId} required placeholder="e.g. cl..." />
            </label>
            <label className="field-block">
              <span>Vote ID</span>
              <input name="voteId" defaultValue={voteId} required placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000" />
            </label>
            <label className="field-block">
              <span>Submitted At Instant</span>
              <input name="submittedAt" defaultValue={submittedAt} required placeholder="e.g. 2026-09-28T14:00:00.000Z" />
            </label>
            <label className="field-block">
              <span>Record Hash</span>
              <input name="recordHash" defaultValue={recordHash} required placeholder="e.g. sha256:..." />
            </label>
            <button type="submit" className="primary-button" style={{ width: "fit-content" }}>
              Verify Ballot Receipt
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
