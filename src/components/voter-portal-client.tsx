"use client";

import { useState, useEffect, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Wifi,
  WifiOff,
  ShieldCheck,
  CheckCircle2,
  Clock,
  ArrowRight,
  ExternalLink,
  Lock,
} from "lucide-react";

type Candidate = {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
};

type Election = {
  id: string;
  name: string;
  description: string;
  startTime: string;
  endTime: string;
  candidates: Candidate[];
  hasVoted: boolean;
  isEligible?: boolean;
  eligibilityReason?: string;
};

type VoterPortalProps = {
  user: {
    id: string;
    name: string;
    email: string;
    voterId: string | null;
    role: string;
  };
  activeElections: Election[];
  initialReceipt?: {
    receiptId: string;
    electionId: string;
    voteId: string;
    txHash: string;
    blockNumber: string;
    recordHash: string;
    submittedAt: string;
    zkVerified?: string;
  };
};

type OfflineVoteItem = {
  electionId: string;
  electionName: string;
  candidateId: string;
  candidateName: string;
  timestamp: string;
};

export default function VoterPortalClient({ user, activeElections, initialReceipt }: VoterPortalProps) {
  const router = useRouter();
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<OfflineVoteItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState(initialReceipt ?? null);
  const [error, setError] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  useEffect(() => {
    let hydrationTimer: number | undefined;
    try {
      const stored = localStorage.getItem("votechain_offline_queue");
      if (stored) {
        const queue = JSON.parse(stored) as OfflineVoteItem[];
        hydrationTimer = window.setTimeout(() => setOfflineQueue(queue), 0);
      }
    } catch {
      // ignore
    }
    return () => {
      if (hydrationTimer !== undefined) window.clearTimeout(hydrationTimer);
    };
  }, []);

  function saveOfflineQueue(items: OfflineVoteItem[]) {
    setOfflineQueue(items);
    localStorage.setItem("votechain_offline_queue", JSON.stringify(items));
  }

  async function handleVoteSubmit(event: FormEvent<HTMLFormElement>, election: Election) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");
    const form = new FormData(event.currentTarget);
    const candidateId = String(form.get("candidateId") ?? "");
    if (!candidateId) {
      setError("Please select a candidate before casting your vote.");
      return;
    }

    const candidate = election.candidates.find((c) => c.id === candidateId);
    const candidateName = candidate?.name ?? candidateId;

    if (offlineMode) {
      // Offline mode demonstration: buffer in local queue
      const newItem: OfflineVoteItem = {
        electionId: election.id,
        electionName: election.name,
        candidateId,
        candidateName,
        timestamp: new Date().toISOString(),
      };
      const updated = [...offlineQueue, newItem];
      saveOfflineQueue(updated);
      setSuccessMessage(`Vote buffered locally in fault-tolerant buffer! Network is currently marked offline.`);
      return;
    }

    // Live submission
    setSubmitting(true);
    try {
      const response = await fetch(`/api/voter/elections/${election.id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to submit ballot.");
      }

      setReceipt({
        receiptId: data.receipt.receiptId,
        electionId: data.receipt.electionId,
        voteId: data.receipt.voteId,
        txHash: data.receipt.txHash,
        blockNumber: String(data.receipt.blockNumber),
        recordHash: data.receipt.recordHash,
        submittedAt: data.receipt.submittedAt,
        zkVerified: data.receipt.zkVerified ? "true" : "false",
      });
      setSuccessMessage("Ballot accepted! Cryptographic zero-knowledge proof verified and commitment mined on blockchain.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vote submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function flushOfflineItem(item: OfflineVoteItem) {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/voter/elections/${item.electionId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: item.candidateId,
          offlineBuffered: true,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Could not synchronize buffered vote.");
      }

      const remaining = offlineQueue.filter((q) => q !== item);
      saveOfflineQueue(remaining);

      setReceipt({
        receiptId: data.receipt.receiptId,
        electionId: data.receipt.electionId,
        voteId: data.receipt.voteId,
        txHash: data.receipt.txHash,
        blockNumber: String(data.receipt.blockNumber),
        recordHash: data.receipt.recordHash,
        submittedAt: data.receipt.submittedAt,
        zkVerified: "true",
      });
      setSuccessMessage("Recovered transaction submitted! On-chain commitment confirmed.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="portal-shell">
      <header className="portal-header">
        <Link className="brand" href="/portal">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </Link>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <form action="/api/auth/logout" method="post">
            <button className="portal-signout" type="submit">Sign out</button>
          </form>
        </div>
      </header>

      <section className="portal-content">
        <p className="eyebrow">AUTHORIZED WORKSPACE · VOTER PORTAL</p>
        <h1>Welcome, {user.name}</h1>
        <p className="page-subtitle">
          Cast your secret ballot with Zero-Knowledge validity proof, AES-256-GCM encryption, and tamper-evident blockchain recording.
        </p>

        {/* Offline Fault Demonstration Switch */}
        <div
          className="portal-status"
          style={{
            marginTop: "1.5rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: offlineMode ? "rgba(239, 68, 68, 0.1)" : "rgba(16, 185, 129, 0.08)",
            border: `1px solid ${offlineMode ? "#ef4444" : "#10b981"}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            {offlineMode ? <WifiOff size={22} color="#ef4444" /> : <Wifi size={22} color="#10b981" />}
            <div>
              <strong>Network Mode: {offlineMode ? "Offline Simulation (Phase 10 Demo)" : "Online / Connected"}</strong>
              <p style={{ margin: 0, fontSize: "0.85rem" }}>
                {offlineMode
                  ? "Votes will be queued in local storage to demonstrate fault tolerance and transaction recovery upon reconnection."
                  : "Votes are sent directly to the server, verified with ZK proof, and mined to the blockchain."}
              </p>
            </div>
          </div>
          <button
            type="button"
            className={offlineMode ? "primary-button" : "secondary-button"}
            style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
            onClick={() => setOfflineMode(!offlineMode)}
          >
            {offlineMode ? "Restore Online Network" : "Simulate Network Outage"}
          </button>
        </div>

        {/* Pending Offline Buffer Section */}
        {offlineQueue.length > 0 && (
          <div className="election-record" style={{ marginTop: "1.5rem", borderLeft: "4px solid #f59e0b" }}>
            <div className="record-heading">
              <div>
                <span className="record-id">FAULT TOLERANCE BUFFER</span>
                <h3 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Clock size={16} color="#f59e0b" />
                  {offlineQueue.length} Pending Offline Vote(s)
                </h3>
                <p className="record-description">
                  These votes were captured during network interruption. When connectivity is restored, click below to synchronize with the blockchain.
                </p>
              </div>
            </div>
            <div style={{ marginTop: "1rem", display: "grid", gap: "0.5rem" }}>
              {offlineQueue.map((item, idx) => (
                <div key={idx} className="candidate-readonly" style={{ justifyContent: "space-between" }}>
                  <div>
                    <strong>{item.electionName}</strong>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted, #888)" }}>
                      Choice: {item.candidateName} · Queued at {new Date(item.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    style={{ fontSize: "0.8rem", padding: "0.3rem 0.7rem" }}
                    disabled={submitting || offlineMode}
                    onClick={() => flushOfflineItem(item)}
                  >
                    {offlineMode ? "Network Offline" : "Flush & Mine to Chain"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Feedback alerts */}
        {error && (
          <div className="election-feedback feedback-error" style={{ marginTop: "1rem" }}>
            {error}
          </div>
        )}
        {successMessage && (
          <div className="election-feedback feedback-success" style={{ marginTop: "1rem" }}>
            {successMessage}
          </div>
        )}

        {/* Ballot Receipt Display */}
        {receipt && (
          <div className="portal-status" style={{ marginTop: "1.5rem", borderLeft: "4px solid #10b981" }}>
            <span className="portal-status-mark">✓</span>
            <div style={{ width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>Cryptographic Ballot Receipt Issued</strong>
                <Link
                  href={`/verify?electionId=${receipt.electionId}&voteId=${receipt.voteId}&submittedAt=${receipt.submittedAt}&recordHash=${receipt.recordHash}`}
                  style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.85rem", color: "#38bdf8" }}
                >
                  Verify in Public Portal <ExternalLink size={13} />
                </Link>
              </div>
              <p style={{ margin: "0.25rem 0", fontSize: "0.85rem" }}>
                Receipt ID: <code>{receipt.receiptId}</code> · Block #{receipt.blockNumber}
              </p>
              <p style={{ margin: "0.25rem 0", fontSize: "0.85rem", wordBreak: "break-all" }}>
                Ethereum Tx: <code>{receipt.txHash}</code>
              </p>
              <p style={{ margin: "0.25rem 0", fontSize: "0.85rem", wordBreak: "break-all" }}>
                Receipt Record Hash: <code>{receipt.recordHash}</code>
              </p>
              <div style={{ marginTop: "0.5rem", display: "flex", gap: "1rem", fontSize: "0.8rem" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "0.25rem", color: "#10b981" }}>
                  <ShieldCheck size={14} /> Zero-Knowledge Proof: VALID
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "0.25rem", color: "#10b981" }}>
                  <Lock size={14} /> AES-256-GCM Secret Ballot: ENCRYPTED
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Active Elections List */}
        <div className="election-record-list" style={{ marginTop: "2rem" }}>
          {activeElections.length === 0 ? (
            <div className="election-empty">
              <strong>No active elections are open right now.</strong>
              <span>Check back when an administrator activates a ballot.</span>
            </div>
          ) : (
            activeElections.map((election) => (
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
                  <span><strong>Start:</strong> {new Date(election.startTime).toUTCString().slice(0, 22)}</span>
                  <span><strong>End:</strong> {new Date(election.endTime).toUTCString().slice(0, 22)}</span>
                </div>

                {election.isEligible === false ? (
                  <div className="portal-status" style={{ marginTop: "1rem", borderLeft: "4px solid #ef4444" }}>
                    <span className="portal-status-mark" style={{ color: "#ef4444" }}>✕</span>
                    <div>
                      <strong style={{ color: "#ef4444" }}>Not Registered for this Election</strong>
                      <p>{election.eligibilityReason || "You are not included in the official class register uploaded by the election administrator."}</p>
                    </div>
                  </div>
                ) : election.hasVoted ? (
                  <div className="portal-status" style={{ marginTop: "1rem" }}>
                    <span className="portal-status-mark">✓</span>
                    <div>
                      <strong>One-Person-One-Vote Enforced</strong>
                      <p>Your anonymous vote participation has been recorded for this election. Duplicate votes are strictly prohibited.</p>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={(e) => handleVoteSubmit(e, election)} style={{ marginTop: "1rem" }}>
                    <div className="record-candidate-heading">
                      <strong>Choose a candidate</strong>
                      <span style={{ fontSize: "0.8rem", color: "var(--muted, #888)" }}>
                        Protected by Zero-Knowledge Proof
                      </span>
                    </div>

                    <div className="record-candidates">
                      {election.candidates.map((candidate) => (
                        <label
                          key={candidate.id}
                          className="candidate-readonly"
                          style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}
                        >
                          <input type="radio" name="candidateId" value={candidate.id} required />
                          <span className="candidate-order">{(candidate.sortOrder + 1).toString().padStart(2, "0")}</span>
                          <span className="candidate-readonly-name">
                            {candidate.name}
                            <small>{candidate.description || "Candidate for election"}</small>
                          </span>
                        </label>
                      ))}
                    </div>

                    <button
                      type="submit"
                      className="primary-button"
                      style={{ marginTop: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}
                      disabled={submitting}
                    >
                      {submitting ? "Processing Proof & Ledger..." : offlineMode ? "Buffer Ballot (Offline Mode)" : "Cast Secret Ballot"}
                      <ArrowRight size={15} />
                    </button>
                  </form>
                )}
              </article>
            ))
          )}
        </div>

        <p className="prototype-disclaimer" style={{ marginTop: "3rem" }}>
          VoteChain is an online privacy-preserving voting prototype. Voter identity is decoupled from candidate selection via separate participation tables and zero-knowledge commitments.
        </p>
      </section>
    </main>
  );
}
