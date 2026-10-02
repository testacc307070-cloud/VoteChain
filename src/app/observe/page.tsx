"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Eye, Shield, Lock, FileText, CheckCircle2, AlertTriangle, ArrowRight, RefreshCw, KeyRound } from "lucide-react";

interface ElectionSummary {
  id: string;
  name: string;
  status: string;
  startTime: string;
  endTime: string;
}

interface ObservationData {
  id: string;
  name: string;
  description: string;
  status: string;
  startTime: string;
  endTime: string;
  resultsPublishedAt: string | null;
  totalVotesCast: number;
  totalEligibleVoters: number;
  merkleRoot: string | null;
  candidates: Array<{
    id: string;
    name: string;
    description: string;
    sortOrder: number;
    voteCount: number | null;
  }>;
  blockchain: {
    blockCount: number;
    blocks: Array<{
      id: string;
      index: number;
      previousHash: string;
      hash: string;
      timestamp: string;
    }>;
  };
  auditLogs: Array<{
    id: string;
    eventType: string;
    actorReference: string;
    details: string;
    timestamp: string;
  }>;
}

export default function ObservePage() {
  const [elections, setElections] = useState<ElectionSummary[]>([]);
  const [selectedElectionId, setSelectedElectionId] = useState<string>("");
  const [accessCode, setAccessCode] = useState<string>("");
  const [validatedElection, setValidatedElection] = useState<{ id: string; name: string } | null>(null);
  const [obsData, setObsData] = useState<ObservationData | null>(null);

  const [loadingList, setLoadingList] = useState(true);
  const [validating, setValidating] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    fetch("/api/elections")
      .then(async (res) => {
        const data = await res.json();
        if (res.ok && data.elections) {
          const list = data.elections.filter((e: ElectionSummary) =>
            ["ACTIVE", "CLOSED", "RESULTS_PUBLISHED"].includes(e.status)
          );
          setElections(list);
          if (list.length > 0) {
            setSelectedElectionId(list[0].id);
          }
        }
      })
      .catch(() => {
        setError("Could not load elections.");
      })
      .finally(() => {
        setLoadingList(false);
      });
  }, []);

  const handleValidateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedElectionId || !accessCode.trim()) return;

    setError("");
    setValidating(true);
    try {
      const res = await fetch(`/api/elections/${selectedElectionId}/observe/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: accessCode.trim().toUpperCase() }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setValidatedElection({ id: data.electionId, name: data.electionName });
        loadObservationData(data.electionId);
      } else {
        setError(data.error || "Invalid access code.");
      }
    } catch {
      setError("Network error validating observer access code.");
    } finally {
      setValidating(false);
    }
  };

  const loadObservationData = async (electionId: string) => {
    setLoadingData(true);
    try {
      const res = await fetch(`/api/elections/${electionId}/observe/data`);
      const data = await res.json();
      if (res.ok && data.election) {
        setObsData(data.election);
      } else {
        setError(data.error || "Could not load observation data.");
      }
    } catch {
      setError("Network error loading observation data.");
    } finally {
      setLoadingData(false);
    }
  };

  const handleExitObserver = () => {
    setValidatedElection(null);
    setObsData(null);
    setAccessCode("");
    setError("");
  };

  return (
    <main className="portal-shell" style={{ minHeight: "100vh", padding: "24px 20px" }}>
      {/* Top Header */}
      <header className="portal-header" style={{ maxWidth: 1100, margin: "0 auto 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Link className="brand" href="/" aria-label="VoteChain home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: "0.85rem", color: "#94a3b8", display: "flex", alignItems: "center", gap: 6 }}>
            <Eye style={{ width: 16, height: 16, color: "#38bdf8" }} /> Independent Observer Workspace
          </span>
          <Link
            href="/login"
            style={{
              fontSize: "0.82rem",
              padding: "6px 14px",
              backgroundColor: "#1e293b",
              color: "#f8fafc",
              borderRadius: 6,
              textDecoration: "none",
            }}
          >
            Sign In
          </Link>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {!validatedElection ? (
          /* Access Code Prompt Box */
          <div className="login-box" style={{ maxWidth: 500, margin: "40px auto", padding: "32px" }}>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ display: "inline-flex", padding: 10, borderRadius: 12, backgroundColor: "rgba(56, 189, 248, 0.15)", marginBottom: 12 }}>
                <Eye style={{ width: 32, height: 32, color: "#38bdf8" }} />
              </div>
              <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#ffffff", margin: "0 0 6px" }}>
                Election Observer Portal
              </h1>
              <p style={{ fontSize: "0.85rem", color: "#94a3b8", margin: 0 }}>
                Enter your election-specific access code to inspect cryptographic integrity
              </p>
            </div>

            {error && (
              <div style={{ backgroundColor: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 18, color: "#fca5a5", fontSize: "0.85rem" }}>
                {error}
              </div>
            )}

            <form onSubmit={handleValidateCode}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "#cbd5e1", marginBottom: 6 }}>
                  Select Election to Observe
                </label>
                <select
                  value={selectedElectionId}
                  onChange={(e) => setSelectedElectionId(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    backgroundColor: "#090d16",
                    border: "1px solid #1e293b",
                    borderRadius: 8,
                    color: "#ffffff",
                    fontSize: "0.9rem",
                  }}
                  disabled={loadingList || elections.length === 0}
                >
                  {elections.length === 0 ? (
                    <option value="">No active or closed elections available</option>
                  ) : (
                    elections.map((elec) => (
                      <option key={elec.id} value={elec.id}>
                        {elec.name} ({elec.status})
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "#cbd5e1", marginBottom: 6 }}>
                  Election Observer Access Code
                </label>
                <input
                  type="text"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  placeholder="e.g. VC-OBS-XXXX-XXXX-XXXX"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    backgroundColor: "#090d16",
                    border: "1px solid #1e293b",
                    borderRadius: 8,
                    color: "#ffffff",
                    fontSize: "0.95rem",
                    fontFamily: "monospace",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                  required
                />
                <span style={{ display: "block", fontSize: "0.75rem", color: "#64748b", marginTop: 4 }}>
                  Provided by the election administrator for this specific election.
                </span>
              </div>

              <button
                type="submit"
                disabled={validating || !selectedElectionId || !accessCode.trim()}
                style={{
                  width: "100%",
                  padding: "12px",
                  backgroundColor: "#0284c7",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: "0.95rem",
                  cursor: validating ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <KeyRound style={{ width: 16, height: 16 }} />
                {validating ? "Verifying Access Code..." : "Enter Observer Dashboard"}
              </button>
            </form>
          </div>
        ) : (
          /* Scoped Read-Only Observer Dashboard */
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, paddingBottom: 16, borderBottom: "1px solid #1e293b" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#ffffff", margin: 0 }}>
                    {obsData?.name || validatedElection.name}
                  </h1>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      padding: "3px 10px",
                      borderRadius: 999,
                      backgroundColor:
                        obsData?.status === "RESULTS_PUBLISHED" ? "rgba(16, 185, 129, 0.2)" :
                        obsData?.status === "ACTIVE" ? "rgba(56, 189, 248, 0.2)" : "rgba(245, 158, 11, 0.2)",
                      color:
                        obsData?.status === "RESULTS_PUBLISHED" ? "#34d399" :
                        obsData?.status === "ACTIVE" ? "#38bdf8" : "#fbbf24",
                      border: "1px solid currentColor",
                    }}
                  >
                    {obsData?.status || "OBSERVING"}
                  </span>
                </div>
                <p style={{ fontSize: "0.85rem", color: "#94a3b8", margin: "4px 0 0" }}>
                  Auditing read-only micro-ledger and cryptographic proofs for this election
                </p>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => loadObservationData(validatedElection.id)}
                  disabled={loadingData}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 14px",
                    backgroundColor: "#1e293b",
                    color: "#f8fafc",
                    border: "none",
                    borderRadius: 6,
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }}
                >
                  <RefreshCw style={{ width: 14, height: 14, animation: loadingData ? "spin 1s infinite" : "none" }} /> Refresh
                </button>
                <button
                  onClick={handleExitObserver}
                  style={{
                    padding: "8px 14px",
                    backgroundColor: "#334155",
                    color: "#f8fafc",
                    border: "none",
                    borderRadius: 6,
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }}
                >
                  Switch Election
                </button>
              </div>
            </div>

            {loadingData && !obsData ? (
              <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>Loading observation metrics...</div>
            ) : obsData ? (
              <div>
                {/* Metric Cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24 }}>
                  <div style={{ backgroundColor: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: 20 }}>
                    <div style={{ fontSize: "0.78rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                      Total Votes Cast
                    </div>
                    <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#ffffff" }}>
                      {obsData.totalVotesCast}
                    </div>
                  </div>

                  <div style={{ backgroundColor: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: 20 }}>
                    <div style={{ fontSize: "0.78rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                      Blockchain Blocks
                    </div>
                    <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#38bdf8" }}>
                      {obsData.blockchain.blockCount}
                    </div>
                  </div>

                  <div style={{ backgroundColor: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: 20 }}>
                    <div style={{ fontSize: "0.78rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                      Eligible Voters
                    </div>
                    <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#f8fafc" }}>
                      {obsData.totalEligibleVoters}
                    </div>
                  </div>

                  <div style={{ backgroundColor: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: 20 }}>
                    <div style={{ fontSize: "0.78rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                      Merkle Root Status
                    </div>
                    <div style={{ fontSize: "0.95rem", fontWeight: 600, color: obsData.merkleRoot ? "#34d399" : "#fbbf24", wordBreak: "break-all", fontFamily: "monospace" }}>
                      {obsData.merkleRoot ? `${obsData.merkleRoot.slice(0, 16)}...` : "Building upon tally"}
                    </div>
                  </div>
                </div>

                {/* Candidate Tally / Roster */}
                <div style={{ backgroundColor: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 24 }}>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#ffffff", margin: "0 0 16px" }}>
                    Candidate Roster {obsData.status === "RESULTS_PUBLISHED" ? "& Final Tally" : ""}
                  </h3>
                  <div style={{ display: "grid", gap: 12 }}>
                    {obsData.candidates.map((cand) => (
                      <div
                        key={cand.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          backgroundColor: "#0b0f19",
                          border: "1px solid #1e293b",
                          borderRadius: 8,
                          padding: "12px 16px",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, color: "#f8fafc" }}>{cand.name}</div>
                          {cand.description && <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>{cand.description}</div>}
                        </div>
                        {cand.voteCount !== null ? (
                          <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#34d399" }}>
                            {cand.voteCount} votes
                          </div>
                        ) : (
                          <div style={{ fontSize: "0.8rem", color: "#64748b" }}>Encrypted (2-of-3 Custody)</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Audit Logs */}
                <div style={{ backgroundColor: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: 20 }}>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#ffffff", margin: "0 0 16px" }}>
                    Election Audit Log Stream
                  </h3>
                  <div style={{ display: "grid", gap: 8 }}>
                    {obsData.auditLogs.map((log) => (
                      <div
                        key={log.id}
                        style={{
                          backgroundColor: "#0b0f19",
                          border: "1px solid #1e293b",
                          borderRadius: 6,
                          padding: "10px 14px",
                          fontSize: "0.82rem",
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <div>
                          <span style={{ color: "#38bdf8", fontWeight: 600, marginRight: 8 }}>{log.eventType}</span>
                          <span style={{ color: "#cbd5e1" }}>{log.details}</span>
                        </div>
                        <span style={{ color: "#64748b", whiteSpace: "nowrap", marginLeft: 16 }}>
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
