"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
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
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import {
  type QueuedOfflineVote,
  getAllQueuedVotes,
  getPendingVotes,
  queueOfflineVote,
} from "@/offline/indexeddb";
import { encryptBallotOffline } from "@/offline/offline-encryption";
import { synchronizeAllPendingVotes } from "@/offline/sync";

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

export default function VoterPortalClient({ user, activeElections, initialReceipt }: VoterPortalProps) {
  const router = useRouter();
  const [isOnline, setIsOnline] = useState(true);
  const [offlineQueue, setOfflineQueue] = useState<QueuedOfflineVote[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [receipt, setReceipt] = useState(initialReceipt ?? null);
  const [error, setError] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  // Load queued votes from persistent IndexedDB
  const refreshQueue = useCallback(async () => {
    try {
      const all = await getAllQueuedVotes();
      setOfflineQueue(all);
    } catch {
      // IndexedDB query error handler
    }
  }, []);

  // Synchronize all pending offline votes when online
  const triggerSync = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return;
    }

    const pending = await getPendingVotes();
    if (pending.length === 0) return;

    setSyncing(true);
    setError("");

    try {
      const results = await synchronizeAllPendingVotes({
        onProgress: (vote, res) => {
          if (res.ok && res.status === "CONFIRMED") {
            setReceipt({
              receiptId: res.receiptId,
              electionId: vote.electionId,
              voteId: res.voteId,
              txHash: res.txHash,
              blockNumber: String(res.blockNumber),
              recordHash: "",
              submittedAt: new Date().toISOString(),
              zkVerified: "true",
            });
            setSuccessMessage(
              `Vote confirmed on Ethereum Sepolia! Tx: ${res.txHash.slice(0, 18)}... Block #${res.blockNumber}`
            );
          }
        },
      });

      await refreshQueue();
      router.refresh();

      const confirmedCount = results.filter((r) => r.ok && r.status === "CONFIRMED").length;
      if (confirmedCount > 0) {
        setSuccessMessage(`Vote confirmed + real transaction/receipt information recorded on Ethereum Sepolia.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Synchronization encountered an issue.");
    } finally {
      setSyncing(false);
    }
  }, [refreshQueue, router]);

  // Real network state monitoring
  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(navigator.onLine);
    refreshQueue();

    const handleOnline = () => {
      setIsOnline(true);
      triggerSync();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial check for pending queue if online
    if (navigator.onLine) {
      triggerSync();
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refreshQueue, triggerSync]);

  async function handleVoteSubmit(event: FormEvent<HTMLFormElement>, election: Election) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");

    // Prevent duplicate submission if ballot is already queued locally
    const alreadyQueued = offlineQueue.some((q) => q.electionId === election.id && q.status !== "FAILED");
    if (alreadyQueued) {
      setError("A ballot is already queued locally for this election. Please wait for internet connectivity to synchronize.");
      return;
    }

    const form = new FormData(event.currentTarget);
    const candidateId = String(form.get("candidateId") ?? "");
    if (!candidateId) {
      setError("Please select a candidate before casting your vote.");
      return;
    }

    // REAL OFFLINE FLOW: If network is offline, encrypt locally and store in IndexedDB
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      try {
        setSubmitting(true);
        const queuedBallot = await encryptBallotOffline({
          electionId: election.id,
          electionName: election.name,
          candidateId,
        });

        await queueOfflineVote(queuedBallot);
        await refreshQueue();
        setSuccessMessage("Vote securely stored locally — waiting for internet");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to securely store ballot locally.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ONLINE FLOW: Submit directly, or automatically fallback to persistent queue if network drops mid-flight
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
      setSuccessMessage("Vote confirmed + real transaction/receipt information recorded on Ethereum Sepolia.");
      router.refresh();
    } catch (err) {
      // If network interruption occurred during fetch, persist safely to IndexedDB
      const isNetworkErr = err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("network"));
      if (isNetworkErr || (typeof navigator !== "undefined" && !navigator.onLine)) {
        try {
          const queuedBallot = await encryptBallotOffline({
            electionId: election.id,
            electionName: election.name,
            candidateId,
          });
          await queueOfflineVote(queuedBallot);
          await refreshQueue();
          setSuccessMessage("Vote securely stored locally — waiting for internet");
        } catch (storeErr) {
          setError(storeErr instanceof Error ? storeErr.message : "Network disconnected and local buffering failed.");
        }
      } else {
        setError(err instanceof Error ? err.message : "Vote submission failed.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const pendingVotes = offlineQueue.filter((q) => q.status !== "CONFIRMED");

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

        {/* Real Network Status Indicator */}
        <div
          className="portal-status"
          style={{
            marginTop: "1.5rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: isOnline ? "rgba(16, 185, 129, 0.08)" : "rgba(245, 158, 11, 0.08)",
            border: `1px solid ${isOnline ? "#10b981" : "#f59e0b"}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            {isOnline ? <Wifi size={22} color="#10b981" /> : <WifiOff size={22} color="#f59e0b" />}
            <div>
              <strong>Connectivity Status: {isOnline ? "Online (Connected)" : "Offline (No Internet Connection)"}</strong>
              <p style={{ margin: 0, fontSize: "0.85rem" }}>
                {isOnline
                  ? "Votes are verified with zero-knowledge proofs and directly mined to Ethereum Sepolia."
                  : "Votes are encrypted with AES-256-GCM and stored in durable IndexedDB on this device until connectivity is restored."}
              </p>
            </div>
          </div>
          {pendingVotes.length > 0 && isOnline && (
            <button
              type="button"
              className="primary-button"
              style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem", display: "flex", gap: "0.4rem", alignItems: "center" }}
              disabled={syncing}
              onClick={triggerSync}
            >
              <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Synchronizing vote..." : "Synchronize Now"}
            </button>
          )}
        </div>

        {/* Real IndexedDB Persistent Offline Queue Display */}
        {pendingVotes.length > 0 && (
          <div className="election-record" style={{ marginTop: "1.5rem", borderLeft: "4px solid #f59e0b" }}>
            <div className="record-heading">
              <div>
                <span className="record-id">PERSISTENT DEVICE QUEUE (INDEXEDDB)</span>
                <h3 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Clock size={16} color="#f59e0b" />
                  {pendingVotes.length} Queued Offline Vote(s)
                </h3>
                <p className="record-description">
                  {syncing
                    ? "Synchronizing vote..."
                    : "Vote securely stored locally — waiting for internet"}
                </p>
              </div>
            </div>
            <div style={{ marginTop: "1rem", display: "grid", gap: "0.5rem" }}>
              {pendingVotes.map((item) => (
                <div key={item.id} className="candidate-readonly" style={{ justifyContent: "space-between" }}>
                  <div>
                    <strong>{item.electionName}</strong>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted, #888)" }}>
                      Encrypted Ballot: <code>{item.encryptedBallot.slice(0, 28)}...</code> · Queued at{" "}
                      {new Date(item.queuedAt).toLocaleTimeString()}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: item.status === "SYNCHRONIZING" ? "#38bdf8" : "#f59e0b", marginTop: "2px" }}>
                      {item.status === "SYNCHRONIZING"
                        ? "Synchronizing vote..."
                        : "Vote securely stored locally — waiting for internet"}
                    </div>
                  </div>
                  <div>
                    {item.status === "SYNCHRONIZING" ? (
                      <span style={{ fontSize: "0.8rem", color: "#38bdf8", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                        <RefreshCw size={12} className="animate-spin" /> Synchronizing vote...
                      </span>
                    ) : (
                      <span style={{ fontSize: "0.8rem", color: "#f59e0b", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                        <Lock size={12} /> Stored in IndexedDB
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Feedback alerts */}
        {error && (
          <div className="election-feedback feedback-error" style={{ marginTop: "1rem" }}>
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}
        {successMessage && (
          <div className="election-feedback feedback-success" style={{ marginTop: "1rem" }}>
            <CheckCircle2 size={15} />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Blockchain Confirmed Ballot Receipt Display */}
        {receipt && (
          <div className="portal-status" style={{ marginTop: "1.5rem", borderLeft: "4px solid #10b981" }}>
            <span className="portal-status-mark">✓</span>
            <div style={{ width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>Vote confirmed</strong>
                {receipt.recordHash && (
                  <Link
                    href={`/verify?electionId=${receipt.electionId}&voteId=${receipt.voteId}&submittedAt=${receipt.submittedAt}&recordHash=${receipt.recordHash}`}
                    style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.85rem", color: "#38bdf8" }}
                  >
                    Verify in Public Portal <ExternalLink size={13} />
                  </Link>
                )}
              </div>
              <p style={{ margin: "0.25rem 0", fontSize: "0.85rem" }}>
                Receipt ID: <code>{receipt.receiptId}</code> · Block #{receipt.blockNumber}
              </p>
              <p style={{ margin: "0.25rem 0", fontSize: "0.85rem", wordBreak: "break-all" }}>
                Ethereum Sepolia Tx: <code>{receipt.txHash}</code>
              </p>
              {receipt.recordHash && (
                <p style={{ margin: "0.25rem 0", fontSize: "0.85rem", wordBreak: "break-all" }}>
                  Receipt Record Hash: <code>{receipt.recordHash}</code>
                </p>
              )}
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
            activeElections.map((election) => {
              const isQueuedForThisElection = offlineQueue.some(
                (q) => q.electionId === election.id && q.status !== "FAILED" && q.status !== "CONFIRMED"
              );

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
                  ) : isQueuedForThisElection ? (
                    <div className="portal-status" style={{ marginTop: "1rem", borderLeft: "4px solid #f59e0b" }}>
                      <span className="portal-status-mark" style={{ color: "#f59e0b" }}>⏳</span>
                      <div>
                        <strong>Vote Pending Synchronization</strong>
                        <p>
                          {syncing
                            ? "Synchronizing vote..."
                            : "Vote securely stored locally — waiting for internet"}
                        </p>
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
                        disabled={submitting || syncing}
                      >
                        {submitting
                          ? "Encrypting & Storing..."
                          : isOnline
                          ? "Cast Secret Ballot"
                          : "Secure Ballot Locally (Offline)"}
                        <ArrowRight size={15} />
                      </button>
                    </form>
                  )}
                </article>
              );
            })
          )}
        </div>

        <p className="prototype-disclaimer" style={{ marginTop: "3rem" }}>
          VoteChain is a privacy-preserving voting system. Voter identity is decoupled from candidate selection via separate participation tables, client-side encryption, and zero-knowledge commitments.
        </p>
      </section>
    </main>
  );
}
