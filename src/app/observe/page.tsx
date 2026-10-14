"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Eye,
  ShieldCheck,
  Lock,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  KeyRound,
  ExternalLink,
  Layers,
  Users,
  Vote,
  Trophy,
} from "lucide-react";

interface ElectionSummary {
  id: string;
  name: string;
  description: string;
  status: string;
  startTime: string;
  endTime: string;
  candidatesCount?: number;
  totalVotesCast?: number;
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
  turnoutPercentage: number | null;
  merkleRoot: string | null;
  candidates: Array<{
    id: string;
    name: string;
    description: string;
    sortOrder: number;
    voteCount: number | null;
  }>;
  winner?: {
    candidateId: string;
    name: string;
    voteCount: number;
  } | null;
  blockchain: {
    blockCount: number;
    blocks: Array<{
      id: string;
      index: number;
      previousHash: string;
      hash: string;
      timestamp: string;
    }>;
    isChainValid: boolean;
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
  const [sessionToken, setSessionToken] = useState<string>("");
  const [validatedElection, setValidatedElection] = useState<{ id: string; name: string } | null>(null);
  const [obsData, setObsData] = useState<ObservationData | null>(null);

  const [loadingList, setLoadingList] = useState(true);
  const [validating, setValidating] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string>("");

  const autoRefreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load observable elections list
  useEffect(() => {
    fetch("/api/elections")
      .then(async (res) => {
        const data = await res.json();
        if (res.ok && data.elections) {
          setElections(data.elections);
          if (data.elections.length > 0) {
            setSelectedElectionId(data.elections[0].id);
          }
        }
      })
      .catch(() => {
        // Fallback or offline
      })
      .finally(() => {
        setLoadingList(false);
      });
  }, []);

  const loadObservationData = useCallback(async (electionId: string, token: string) => {
    setLoadingData(true);
    try {
      const res = await fetch(`/api/elections/${electionId}/observe/data`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-observer-token": token,
        },
      });

      const data = await res.json();
      if (res.ok && data.election) {
        setObsData(data.election);
        setLastUpdated(new Date());
        setError("");
      } else {
        setError(data.error || "Could not load observation data.");
        if (res.status === 401 || res.status === 403) {
          // Token expired or revoked by administrator
          setValidatedElection(null);
          setSessionToken("");
          setObsData(null);
        }
      }
    } catch {
      setError("Network error loading observation data.");
    } finally {
      setLoadingData(false);
    }
  }, []);

  // Auto-refresh while election is active
  useEffect(() => {
    if (autoRefreshTimerRef.current) {
      clearInterval(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }

    if (validatedElection && sessionToken && autoRefreshEnabled && obsData?.status === "ACTIVE") {
      autoRefreshTimerRef.current = setInterval(() => {
        loadObservationData(validatedElection.id, sessionToken);
      }, 15000);
    }

    return () => {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
      }
    };
  }, [validatedElection, sessionToken, autoRefreshEnabled, obsData?.status, loadObservationData]);

  const handleValidateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = accessCode.trim().toUpperCase();
    if (!cleanCode) {
      setError("Please enter your observer access code.");
      return;
    }

    setError("");
    setValidating(true);

    try {
      // Validate via global observer validate endpoint
      const res = await fetch("/api/observe/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessCode: cleanCode,
          electionId: selectedElectionId || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setSessionToken(data.sessionToken);
        setValidatedElection({ id: data.electionId, name: data.electionName });
        loadObservationData(data.electionId, data.sessionToken);
      } else {
        setError(data.error || "Invalid access code. Please check with the election administrator.");
      }
    } catch {
      setError("Network error connecting to validation server.");
    } finally {
      setValidating(false);
    }
  };

  const handleExitObserver = () => {
    setValidatedElection(null);
    setSessionToken("");
    setObsData(null);
    setAccessCode("");
    setError("");
  };

  return (
    <main className="portal-shell" style={{ minHeight: "100vh" }}>
      {/* Header */}
      <header className="portal-header">
        <Link className="brand" href="/" aria-label="VoteChain home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: "12px", color: "var(--muted, #75817d)", display: "flex", alignItems: "center", gap: 6 }}>
            <Eye style={{ width: 15, height: 15, color: "#2c795e" }} />
            Independent Observer Workspace
          </span>
          <Link
            href="/login"
            className="secondary-button"
            style={{ fontSize: "11px", padding: "4px 10px", height: "30px" }}
          >
            Sign in
          </Link>
        </div>
      </header>

      <section className="portal-content" style={{ width: "min(1080px, calc(100% - 32px))", margin: "32px auto" }}>
        {!validatedElection ? (
          /* Access Code Prompt Box */
          <div
            className="login-box"
            style={{
              maxWidth: 480,
              margin: "40px auto",
              padding: "32px",
              backgroundColor: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              boxShadow: "0 4px 20px -2px rgba(15, 23, 42, 0.08)",
            }}
          >
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div
                style={{
                  display: "inline-flex",
                  padding: 10,
                  borderRadius: 12,
                  backgroundColor: "rgba(44, 121, 94, 0.1)",
                  marginBottom: 12,
                }}
              >
                <Eye style={{ width: 32, height: 32, color: "#2c795e" }} />
              </div>
              <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#0f172a", margin: "0 0 6px" }}>
                Election Observer Portal
              </h1>
              <p style={{ fontSize: "0.85rem", color: "#475569", margin: 0 }}>
                Enter your election-scoped access code to inspect real-time cryptographic integrity, turnout, and blockchain commitments.
              </p>
            </div>

            {error && (
              <div
                style={{
                  backgroundColor: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  padding: "10px 14px",
                  marginBottom: 18,
                  color: "#991b1b",
                  fontSize: "0.85rem",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleValidateCode}>
              {/* Optional Election selector */}
              {elections.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#1e293b", marginBottom: 6 }}>
                    Select Election (Optional)
                  </label>
                  <select
                    value={selectedElectionId}
                    onChange={(e) => setSelectedElectionId(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      backgroundColor: "#ffffff",
                      border: "1px solid #cbd5e1",
                      borderRadius: 8,
                      color: "#0f172a",
                      fontSize: "0.9rem",
                    }}
                  >
                    <option value="">Auto-resolve from access code</option>
                    {elections.map((elec) => (
                      <option key={elec.id} value={elec.id}>
                        {elec.name} ({elec.status})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Access Code Input */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#1e293b", marginBottom: 6 }}>
                  Observer Access Code
                </label>
                <input
                  type="text"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  placeholder="e.g. VC-OBS-XXXX-XXXX-XXXX"
                  required
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    backgroundColor: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    color: "#0f172a",
                    fontSize: "0.95rem",
                    fontFamily: "var(--font-data), monospace",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    boxSizing: "border-box",
                  }}
                />
                <span style={{ display: "block", fontSize: "0.75rem", color: "#64748b", marginTop: 4 }}>
                  Provided by the election administrator. Grants read-only observation access.
                </span>
              </div>

              <button
                type="submit"
                disabled={validating || !accessCode.trim()}
                style={{
                  width: "100%",
                  padding: "12px",
                  backgroundColor: accessCode.trim() ? "#2c795e" : "#cbd5e1",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: "0.95rem",
                  cursor: validating || !accessCode.trim() ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  transition: "background-color 0.15s ease",
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
            {/* Top Bar inside Dashboard */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 14,
                marginBottom: 24,
                paddingBottom: 16,
                borderBottom: "1px solid var(--line, #e6e9e5)",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <h1 style={{ fontSize: "1.45rem", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                    {obsData?.name || validatedElection.name}
                  </h1>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      padding: "3px 10px",
                      borderRadius: 16,
                      backgroundColor:
                        obsData?.status === "RESULTS_PUBLISHED"
                          ? "#eaf5ee"
                          : obsData?.status === "ACTIVE"
                          ? "#eff6ff"
                          : "#fef3c7",
                      color:
                        obsData?.status === "RESULTS_PUBLISHED"
                          ? "#2c795e"
                          : obsData?.status === "ACTIVE"
                          ? "#1d4ed8"
                          : "#92400e",
                      border: "1px solid currentColor",
                      letterSpacing: "0.04em",
                    }}
                  >
                    STATUS: {obsData?.status || "OBSERVING"}
                  </span>
                </div>
                <p style={{ fontSize: "0.85rem", color: "#64748b", margin: "4px 0 0" }}>
                  Independent read-only audit stream · Micro-ledger blocks and cryptographic proofs
                </p>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {obsData?.status === "ACTIVE" && (
                  <button
                    onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "6px 12px",
                      backgroundColor: autoRefreshEnabled ? "#eaf5ee" : "#f1f5f9",
                      color: autoRefreshEnabled ? "#2c795e" : "#64748b",
                      border: "1px solid #cbd5e1",
                      borderRadius: 6,
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      fontWeight: 500,
                    }}
                  >
                    <RefreshCw size={12} className={autoRefreshEnabled ? "animate-spin" : ""} />
                    Auto-refresh: {autoRefreshEnabled ? "15s" : "Paused"}
                  </button>
                )}
                <button
                  onClick={() => loadObservationData(validatedElection.id, sessionToken)}
                  disabled={loadingData}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    backgroundColor: "#ffffff",
                    color: "#1e293b",
                    border: "1px solid #cbd5e1",
                    borderRadius: 6,
                    fontSize: "0.8rem",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  <RefreshCw size={13} className={loadingData ? "animate-spin" : ""} />
                  Refresh
                </button>
                <button
                  onClick={handleExitObserver}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#f1f5f9",
                    color: "#475569",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    fontSize: "0.8rem",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  Exit Observer View
                </button>
              </div>
            </div>

            {error && (
              <div
                style={{
                  backgroundColor: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  padding: "10px 14px",
                  marginBottom: 18,
                  color: "#991b1b",
                  fontSize: "0.85rem",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}

            {loadingData && !obsData ? (
              <div style={{ textAlign: "center", padding: 60, color: "#64748b" }}>
                <RefreshCw size={24} className="animate-spin" style={{ margin: "0 auto 12px" }} />
                <div>Loading observation metrics from secure ledger...</div>
              </div>
            ) : obsData ? (
              <div>
                {/* 6 Structured Metrics Grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                    gap: 14,
                    marginBottom: 24,
                  }}
                >
                  {/* Total Votes Cast */}
                  <div className="results-meta-card">
                    <span className="results-meta-label">Total Votes Recorded</span>
                    <strong className="results-meta-value" style={{ fontSize: "1.6rem", color: "#1e293b" }}>
                      {obsData.totalVotesCast}
                    </strong>
                    <span style={{ fontSize: "0.75rem", color: "#64748b" }}>Anonymously verified ballots</span>
                  </div>

                  {/* Eligible Voters */}
                  <div className="results-meta-card">
                    <span className="results-meta-label">Eligible Registered Voters</span>
                    <strong className="results-meta-value" style={{ fontSize: "1.6rem", color: "#1e293b" }}>
                      {obsData.totalEligibleVoters}
                    </strong>
                    <span style={{ fontSize: "0.75rem", color: "#64748b" }}>Official institutional register</span>
                  </div>

                  {/* Turnout Percentage */}
                  <div className="results-meta-card">
                    <span className="results-meta-label">Voter Turnout</span>
                    <strong className="results-meta-value" style={{ fontSize: "1.6rem", color: "#2c795e" }}>
                      {obsData.turnoutPercentage !== null ? `${obsData.turnoutPercentage}%` : "N/A"}
                    </strong>
                    <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                      {obsData.totalVotesCast} of {obsData.totalEligibleVoters} eligible
                    </span>
                  </div>

                  {/* Blockchain Block Height */}
                  <div className="results-meta-card">
                    <span className="results-meta-label">Ledger Block Height</span>
                    <strong className="results-meta-value" style={{ fontSize: "1.6rem", color: "#1e293b" }}>
                      {obsData.blockchain.blockCount} Blocks
                    </strong>
                    <span
                      className={`results-meta-badge ${
                        obsData.blockchain.isChainValid ? "results-badge-success" : "results-badge-error"
                      }`}
                      style={{ marginTop: 4 }}
                    >
                      {obsData.blockchain.isChainValid ? "CHAIN VALID" : "CHAIN MISMATCH"}
                    </span>
                  </div>

                  {/* Merkle Root */}
                  <div className="results-meta-card">
                    <span className="results-meta-label">Merkle Tree Root</span>
                    <code className="results-meta-mono" style={{ fontSize: "0.8rem", marginTop: 4 }}>
                      {obsData.merkleRoot ? `${obsData.merkleRoot.slice(0, 22)}...` : "Computed on closing"}
                    </code>
                    <span style={{ fontSize: "0.75rem", color: "#64748b", marginTop: 4 }}>
                      Cryptographic inclusion root
                    </span>
                  </div>

                  {/* Election Window */}
                  <div className="results-meta-card">
                    <span className="results-meta-label">Election Time Window</span>
                    <div style={{ fontSize: "0.8rem", color: "#334155", marginTop: 4 }}>
                      <strong>Start:</strong> {new Date(obsData.startTime).toUTCString().slice(0, 22)}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "#334155", marginTop: 2 }}>
                      <strong>End:</strong> {new Date(obsData.endTime).toUTCString().slice(0, 22)}
                    </div>
                  </div>
                </div>

                {/* Candidate Roster / Results Section */}
                <div
                  style={{
                    backgroundColor: "#ffffff",
                    border: "1px solid var(--line, #e6e9e5)",
                    borderRadius: 8,
                    padding: 20,
                    marginBottom: 24,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                      Candidate Roster {obsData.status === "RESULTS_PUBLISHED" ? "& Official Final Results" : ""}
                    </h3>
                    {obsData.status === "RESULTS_PUBLISHED" && obsData.winner && (
                      <span
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          backgroundColor: "#f0fdf4",
                          color: "#166534",
                          border: "1px solid #bbf7d0",
                          padding: "3px 10px",
                          borderRadius: 6,
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <Trophy size={14} /> Winner: {obsData.winner.name} ({obsData.winner.voteCount} votes)
                      </span>
                    )}
                  </div>

                  {obsData.status !== "RESULTS_PUBLISHED" ? (
                    <div
                      style={{
                        backgroundColor: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        padding: "16px",
                        marginBottom: 16,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#475569", fontWeight: 600, fontSize: "0.9rem" }}>
                        <Lock size={16} color="#2c795e" />
                        <span>Ballot Tallies Withheld During Active Custody</span>
                      </div>
                      <p style={{ fontSize: "0.82rem", color: "#64748b", margin: "6px 0 0", lineHeight: 1.5 }}>
                        In accordance with secret ballot principles, interim vote choices are encrypted with AES-256-GCM.
                        Official counts become visible only after the election closes and results are officially published following 2-of-3 threshold authority key reconstruction.
                      </p>
                    </div>
                  ) : null}

                  <div style={{ display: "grid", gap: 10 }}>
                    {obsData.candidates.map((cand) => {
                      const pct =
                        obsData.totalVotesCast > 0 && cand.voteCount !== null
                          ? Math.round((cand.voteCount / obsData.totalVotesCast) * 100)
                          : 0;

                      return (
                        <div
                          key={cand.id}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            backgroundColor: "#fbfcfb",
                            border: "1px solid #eef1ed",
                            borderRadius: 8,
                            padding: "12px 16px",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                              <strong style={{ color: "#1e293b", fontSize: "0.95rem" }}>{cand.name}</strong>
                              {cand.description && (
                                <span style={{ fontSize: "0.8rem", color: "#64748b", marginLeft: 8 }}>
                                  · {cand.description}
                                </span>
                              )}
                            </div>
                            {cand.voteCount !== null ? (
                              <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#1e293b" }}>
                                {cand.voteCount} votes ({pct}%)
                              </div>
                            ) : (
                              <span style={{ fontSize: "0.75rem", color: "#64748b", fontFamily: "var(--font-data)" }}>
                                ENCRYPTED BALLOT
                              </span>
                            )}
                          </div>
                          {obsData.status === "RESULTS_PUBLISHED" && cand.voteCount !== null && (
                            <div style={{ height: 6, borderRadius: 3, backgroundColor: "#edf0ec", overflow: "hidden" }}>
                              <div
                                style={{
                                  height: "100%",
                                  borderRadius: 3,
                                  backgroundColor: "#2c795e",
                                  width: `${pct}%`,
                                }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Blockchain Micro-Ledger Inspection */}
                <div
                  style={{
                    backgroundColor: "#ffffff",
                    border: "1px solid var(--line, #e6e9e5)",
                    borderRadius: 8,
                    padding: 20,
                    marginBottom: 24,
                  }}
                >
                  <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#1e293b", margin: "0 0 14px" }}>
                    Public Blockchain Ledger Inspection (Recent Blocks)
                  </h3>
                  {obsData.blockchain.blocks.length === 0 ? (
                    <div style={{ color: "#64748b", fontSize: "0.85rem" }}>No blockchain blocks minted yet.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {obsData.blockchain.blocks.map((block) => (
                        <div
                          key={block.id || block.index}
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 8,
                            padding: "8px 12px",
                            backgroundColor: "#fbfcfb",
                            border: "1px solid #edf0ec",
                            borderRadius: 6,
                            fontSize: "0.82rem",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontWeight: 700, color: "#2c795e", fontFamily: "var(--font-data)" }}>
                              Block #{block.index}
                            </span>
                            <code style={{ fontSize: "0.75rem", color: "#475569" }}>
                              Hash: {block.hash.slice(0, 20)}...
                            </code>
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                            {new Date(block.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Audit Log Stream */}
                <div
                  style={{
                    backgroundColor: "#ffffff",
                    border: "1px solid var(--line, #e6e9e5)",
                    borderRadius: 8,
                    padding: 20,
                  }}
                >
                  <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#1e293b", margin: "0 0 14px" }}>
                    Cryptographic Audit Event Log
                  </h3>
                  {obsData.auditLogs.length === 0 ? (
                    <div style={{ color: "#64748b", fontSize: "0.85rem" }}>No audit log events recorded yet.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {obsData.auditLogs.map((log) => (
                        <div
                          key={log.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                            padding: "8px 12px",
                            backgroundColor: "#fbfcfb",
                            border: "1px solid #edf0ec",
                            borderRadius: 6,
                            fontSize: "0.82rem",
                          }}
                        >
                          <div>
                            <span style={{ color: "#2c795e", fontWeight: 700, marginRight: 8, fontFamily: "var(--font-data)" }}>
                              {log.eventType}
                            </span>
                            <span style={{ color: "#334155" }}>{log.details}</span>
                          </div>
                          <span style={{ color: "#64748b", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
