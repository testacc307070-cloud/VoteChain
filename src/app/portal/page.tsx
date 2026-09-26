import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export default async function PortalPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "ADMIN") redirect("/");

  const params = (await searchParams) ?? {};
  const receiptId = typeof params.receiptId === "string" ? params.receiptId : undefined;
  const receiptElectionId = typeof params.electionId === "string" ? params.electionId : undefined;
  const txHash = typeof params.txHash === "string" ? params.txHash : undefined;
  const blockNumber = typeof params.blockNumber === "string" ? params.blockNumber : undefined;
  const recordHash = typeof params.recordHash === "string" ? params.recordHash : undefined;
  const submittedAt = typeof params.submittedAt === "string" ? params.submittedAt : undefined;
  const voteId = typeof params.voteId === "string" ? params.voteId : undefined;

  const roleLabel = user.role.charAt(0) + user.role.slice(1).toLowerCase();
  const activeElections = await prisma.election.findMany({
    where: { status: "ACTIVE" },
    include: { candidates: { orderBy: { sortOrder: "asc" } }, votes: { where: { voterId: user.id }, select: { id: true } } },
    orderBy: [{ startTime: "asc" }],
  });

  return (
    <main className="portal-shell">
      <header className="portal-header"><a className="brand" href="/portal"><span className="brand-mark"><span /><span /><span /></span><span>votechain<span className="brand-period">.</span></span></a><form action="/api/auth/logout" method="post"><button className="portal-signout" type="submit">Sign out</button></form></header>
      <section className="portal-content"><p className="eyebrow">AUTHORIZED WORKSPACE · {roleLabel.toUpperCase()}</p><h1>Welcome, {user.name}</h1><p className="page-subtitle">Your account is authenticated. Active elections are now shown here for voting.</p>
        <div className="portal-status"><span className="portal-status-mark">✓</span><div><strong>{roleLabel} access active</strong><p>Your account has been authenticated and can participate in eligible elections.</p></div></div>

        {receiptId && receiptElectionId && recordHash && submittedAt ? (
          <div className="portal-status" style={{ marginTop: "1.5rem" }}>
            <span className="portal-status-mark">✓</span>
            <div>
              <strong>Ballot receipt created</strong>
              <p>Receipt {receiptId} was issued for election {receiptElectionId}. Transaction {txHash ?? "pending"} · block {blockNumber ?? "n/a"}. Record hash: {recordHash.slice(0, 18)}...</p>
              {voteId ? <small>Verification proof ready for vote {voteId}</small> : null}
            </div>
          </div>
        ) : null}

        <div className="election-record-list" style={{ marginTop: "2rem" }}>
          {activeElections.length === 0 ? (
            <div className="election-empty">
              <strong>No active elections are open right now.</strong>
              <span>Check back when an administrator activates a ballot.</span>
            </div>
          ) : activeElections.map((election) => {
            const hasVoted = election.votes.length > 0;
            return (
              <article className="election-record" key={election.id}>
                <div className="record-heading">
                  <div>
                    <span className="record-id">{election.id}</span>
                    <h3>{election.name}</h3>
                    {election.description && <p className="record-description">{election.description}</p>}
                  </div>
                  <span className="election-status status-active"><i />ACTIVE</span>
                </div>
                <div className="record-metadata">
                  <span><strong>Opening:</strong> {new Date(election.startTime).toISOString().replace("T", " ").slice(0, 16)} UTC</span>
                  <span><strong>Closing:</strong> {new Date(election.endTime).toISOString().replace("T", " ").slice(0, 16)} UTC</span>
                </div>

                {hasVoted ? (
                  <div className="portal-status" style={{ marginTop: "1rem" }}>
                    <span className="portal-status-mark">✓</span>
                    <div>
                      <strong>Vote recorded</strong>
                      <p>Your ballot has already been accepted for this election.</p>
                      {receiptId && receiptElectionId === election.id ? (
                        <small>Receipt {receiptId} · {new Date(submittedAt as string).toISOString().replace("T", " ").slice(0, 16)} UTC</small>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <form method="post" action={`/api/voter/elections/${election.id}/vote`} style={{ marginTop: "1rem" }}>
                    <div className="record-candidate-heading"><strong>Choose a candidate</strong></div>
                    <div className="record-candidates">
                      {election.candidates.map((candidate) => (
                        <label key={candidate.id} className="candidate-readonly" style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}>
                          <input type="radio" name="candidateId" value={candidate.id} required />
                          <span className="candidate-order">{candidate.sortOrder + 1}</span>
                          <span className="candidate-readonly-name">{candidate.name}<small>{candidate.description || "No description"}</small></span>
                        </label>
                      ))}
                    </div>
                    <button type="submit" className="primary-button" style={{ marginTop: "1rem" }}>Submit vote</button>
                  </form>
                )}
              </article>
            );
          })}
        </div>

        <p className="prototype-disclaimer">VoteChain is a research prototype. This portal only handles test ballots and records one vote per eligible voter per election.</p>
      </section>
    </main>
  );
}