"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ElectionRecord } from "@/backend/voting/election-types";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  Check,
  ChevronDown,
  CircleAlert,
  CirclePlus,
  LockKeyhole,
  LogOut,
  Save,
  ShieldAlert,
  StopCircle,
  Trash2,
  Upload,
  UsersRound,
  Vote,
  X,
} from "lucide-react";

type ElectionStatus = ElectionRecord["status"];
type Election = ElectionRecord;
type ElectionManagerProps = { displayName: string; initialElections: ElectionRecord[] };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
  return result;
}

function formatTime(value: string) {
  return `${new Date(value).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

function statusName(status: ElectionStatus) {
  return status.replaceAll("_", " ");
}

const statusCopy: Partial<Record<ElectionStatus, string>> = {
  DRAFT: "Draft configuration remains editable until the candidate list is locked.",
  UPCOMING: "This election is ready to begin and can be activated when voting opens.",
  ACTIVE: "Voting is live. Results stay hidden until the election closes.",
  CLOSED: "Voting is closed. Publishing results unlocks the public verification window.",
  RESULTS_PUBLISHED: "Results are live on the public verification pages and audit view.",
};

const nextAction: Partial<Record<ElectionStatus, { action: string; label: string }>> = {
  DRAFT: { action: "lock", label: "Lock candidate list" },
  UPCOMING: { action: "activate", label: "Activate election" },
  ACTIVE: { action: "close", label: "Close election" },
  CLOSED: { action: "publish", label: "Publish results" },
};

export default function ElectionManager({ displayName, initialElections }: ElectionManagerProps) {
  const router = useRouter();
  const [elections, setElections] = useState<Election[]>(initialElections);
  const [saving, setSaving] = useState(false);
  const [pendingId, setPendingId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const [uploadingId, setUploadingId] = useState<string | null>(null);

  // Modals for Close Early and Delete
  const [closingElection, setClosingElection] = useState<Election | null>(null);
  const [deletingElection, setDeletingElection] = useState<Election | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [actionInProgress, setActionInProgress] = useState(false);

  async function loadElections() {
    try {
      const result = await requestJson<{ elections: Election[] }>("/api/admin/elections");
      setElections(result.elections);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load elections.");
    }
  }

  async function handleCsvUpload(electionId: string, file?: File) {
    if (!file) return;
    setUploadingId(electionId);
    setError("");
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/admin/elections/${electionId}/eligibility`, {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as {
        error?: string;
        message?: string;
        count?: number;
        duplicatesIgnored?: number;
      };
      if (!response.ok) {
        throw new Error(result.error || "Failed to upload class eligibility CSV.");
      }
      setMessage(result.message || `Uploaded ${result.count} eligible voters.`);
      await loadElections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadingId(null);
    }
  }

  async function createElection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSaving(true);
    setError("");
    setMessage("");
    const form = new FormData(formElement);
    const candidateLines = String(form.get("candidates") ?? "")
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);
    const eligibleVoterIds = String(form.get("eligibleVoterIds") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    try {
      const result = await requestJson<{ election: Election }>("/api/admin/elections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          description: form.get("description"),
          startTime: new Date(String(form.get("startTime"))).toISOString(),
          endTime: new Date(String(form.get("endTime"))).toISOString(),
          candidates: candidateLines.map((name) => ({ name, description: "" })),
          eligibleVoterIds,
        }),
      });
      setElections((current) => [result.election, ...current]);
      setFormOpen(false);
      setMessage("Draft election created. Candidate details can still be changed until the list is locked.");
      formElement.reset();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create election.");
    } finally {
      setSaving(false);
    }
  }

  async function updateCandidate(event: FormEvent<HTMLFormElement>, electionId: string, candidateId: string) {
    event.preventDefault();
    setPendingId(candidateId);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await requestJson(`/api/admin/elections/${electionId}/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.get("name"), description: form.get("description") }),
      });
      setMessage("Candidate details saved.");
      await loadElections();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update candidate.");
    } finally {
      setPendingId("");
    }
  }

  async function addCandidate(event: FormEvent<HTMLFormElement>, electionId: string) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPendingId(electionId);
    setError("");
    const form = new FormData(formElement);
    try {
      await requestJson(`/api/admin/elections/${electionId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.get("name"), description: form.get("description") }),
      });
      formElement.reset();
      setMessage("Candidate added.");
      await loadElections();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Could not add candidate.");
    } finally {
      setPendingId("");
    }
  }

  async function removeCandidate(electionId: string, candidateId: string) {
    setPendingId(candidateId);
    setError("");
    try {
      await requestJson(`/api/admin/elections/${electionId}/candidates/${candidateId}`, { method: "DELETE" });
      setMessage("Candidate removed.");
      await loadElections();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove candidate.");
    } finally {
      setPendingId("");
    }
  }

  async function advanceElection(election: Election) {
    const transition = nextAction[election.status];
    if (!transition) return;
    setPendingId(election.id);
    setError("");
    setMessage("");
    try {
      await requestJson(`/api/admin/elections/${election.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: transition.action }),
      });
      setMessage(
        `Election moved to ${statusName(
          election.status === "DRAFT"
            ? "UPCOMING"
            : election.status === "UPCOMING"
            ? "ACTIVE"
            : election.status === "ACTIVE"
            ? "CLOSED"
            : "RESULTS_PUBLISHED"
        ).toLowerCase()}.`
      );
      await loadElections();
    } catch (transitionError) {
      setError(transitionError instanceof Error ? transitionError.message : "Could not change election status.");
    } finally {
      setPendingId("");
    }
  }

  async function executeEarlyClose() {
    if (!closingElection) return;
    setActionInProgress(true);
    setError("");
    setMessage("");
    try {
      await requestJson(`/api/admin/elections/${closingElection.id}/close`, {
        method: "POST",
      });
      setMessage(`Election "${closingElection.name}" was closed early. Voting has been halted.`);
      setClosingElection(null);
      await loadElections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close election early.");
    } finally {
      setActionInProgress(false);
    }
  }

  async function executeDeleteElection() {
    if (!deletingElection) return;
    setActionInProgress(true);
    setError("");
    setMessage("");
    try {
      await requestJson(`/api/admin/elections/${deletingElection.id}`, {
        method: "DELETE",
      });
      setMessage(`Election "${deletingElection.name}" was successfully deleted.`);
      setDeletingElection(null);
      setDeleteConfirmText("");
      await loadElections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete election.");
    } finally {
      setActionInProgress(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <main className="elections-shell">
      <header className="elections-topbar">
        <Link className="brand" href="/" aria-label="VoteChain overview">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </Link>
        <div className="elections-topbar-right">
          <Link className="overview-link" href="/"><ArrowLeft size={15} /> Overview</Link>
          <span className="topbar-divider" />
          <span className="elections-user"><span className="avatar">{initials}</span><span>{displayName}</span></span>
          <button className="icon-button" title="Sign out" aria-label="Sign out" onClick={signOut}><LogOut size={16} /></button>
        </div>
      </header>

      <section className="elections-content">
        <div className="page-heading elections-heading">
          <div>
            <p className="eyebrow">ADMINISTRATION / ELECTION CONTROLS</p>
            <h1>Elections Manager</h1>
            <p className="page-subtitle">Create elections, manage candidates, close live voting early, and review audit trail integrity.</p>
          </div>
          <button className="primary-button" onClick={() => { setFormOpen((open) => !open); setError(""); }}>
            {formOpen ? <X size={16} /> : <CirclePlus size={16} />}
            {formOpen ? "Close form" : "New election"}
          </button>
        </div>

        <div className="election-safety-note">
          <LockKeyhole size={16} />
          <p>
            <strong>Cryptographic Audit Invariant:</strong> Candidate configuration locks prior to voting. Once votes are recorded, an election cannot be deleted to preserve immutable on-chain commitments. Use <em>Close Election Now</em> to conclude voting ahead of schedule.
          </p>
        </div>

        {error && (
          <div className="election-feedback feedback-error" role="alert">
            <CircleAlert size={16} />
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button>
          </div>
        )}
        {message && (
          <div className="election-feedback feedback-success" role="status">
            <Check size={16} />
            {message}
            <button onClick={() => setMessage("")} aria-label="Dismiss message"><X size={15} /></button>
          </div>
        )}

        {formOpen && (
          <section className="election-create-panel" id="new-election">
            <div className="form-section-heading">
              <div><span className="panel-kicker">NEW ELECTION</span><h2>Election setup</h2></div>
              <span className="draft-label">SAVED AS DRAFT</span>
            </div>
            <form className="election-form" onSubmit={createElection}>
              <label className="field-block">
                <span>Election name</span>
                <input name="name" required minLength={3} maxLength={120} placeholder="e.g. Student Council 2027" />
              </label>
              <label className="field-block">
                <span>Description <small>Optional</small></span>
                <textarea name="description" maxLength={2000} rows={2} placeholder="What is this election for?" />
              </label>
              <div className="schedule-fields">
                <label className="field-block">
                  <span>Starts <small>Local time</small></span>
                  <input name="startTime" type="datetime-local" required />
                </label>
                <label className="field-block">
                  <span>Ends <small>Local time</small></span>
                  <input name="endTime" type="datetime-local" required />
                </label>
              </div>
              <label className="field-block">
                <span>Candidates <small>One name per line · 2 to 20</small></span>
                <textarea name="candidates" required rows={4} placeholder={"Jordan Miller\nRiley Kim\nAvery Singh"} />
              </label>
              <label className="field-block">
                <span>Eligible voter IDs <small>Optional; comma-separated user IDs for registry enforcement</small></span>
                <input name="eligibleVoterIds" placeholder="user-1, user-2, user-3" />
              </label>
              <div className="election-form-footer">
                <span>Schedule values are stored as UTC instants.</span>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? "Creating..." : "Create draft"}<ArrowUpRight size={15} />
                </button>
              </div>
            </form>
          </section>
        )}

        <div className="election-list-heading">
          <div>
            <h2>Election register</h2>
            <p>Admin operations enforce 2-of-3 threshold authority and on-chain vote protections.</p>
          </div>
          <span className="election-total">{elections.length.toString().padStart(2, "0")} TOTAL</span>
        </div>

        {elections.length === 0 ? (
          <div className="election-empty">
            <CalendarClock size={21} />
            <strong>No elections created</strong>
            <span>Start with a draft and lock its candidate list when the configuration is ready.</span>
            <button className="text-button" onClick={() => setFormOpen(true)}>Create first election <ArrowUpRight size={14} /></button>
          </div>
        ) : (
          <div className="election-record-list">
            {elections.map((election) => {
              const transition = nextAction[election.status];
              const canAdvance = election.status !== "RESULTS_PUBLISHED" && (election.status !== "DRAFT" || election.candidates.length >= 2);
              const voteCount = election.votesCount ?? 0;
              const isVoted = voteCount > 0;
              const isActive = election.status === "ACTIVE";

              return (
                <article className="election-record" key={election.id}>
                  <div className="record-heading">
                    <div>
                      <span className="record-id">{election.id}</span>
                      <h3>{election.name}</h3>
                      {election.description && <p className="record-description">{election.description}</p>}
                    </div>
                    <span className={`election-status status-${election.status.toLowerCase()}`}>
                      <i />{statusName(election.status)}
                    </span>
                  </div>

                  <div className="record-metadata">
                    <span>
                      <CalendarClock size={14} />
                      <span>START</span>
                      <strong>{formatTime(election.startTime)}</strong>
                    </span>
                    <span>
                      <CalendarClock size={14} />
                      <span>END</span>
                      <strong>{formatTime(election.endTime)}</strong>
                    </span>
                    <span>
                      <UsersRound size={14} />
                      <span>CANDIDATES</span>
                      <strong>{election.candidates.length.toString().padStart(2, "0")}</strong>
                    </span>
                    <span>
                      <Vote size={14} />
                      <span>VOTES CAST</span>
                      <strong>{voteCount.toString()}</strong>
                    </span>
                  </div>

                  <div className="record-candidate-heading">
                    <strong>Candidate list</strong>
                    <span>{election.candidatesLocked ? <><LockKeyhole size={12} /> LOCKED</> : "DRAFT · EDITABLE"}</span>
                  </div>

                  <div className="record-candidates">
                    {election.candidates.map((candidate) =>
                      election.status === "DRAFT" && !election.candidatesLocked ? (
                        <form className="candidate-edit" key={candidate.id} onSubmit={(event) => updateCandidate(event, election.id, candidate.id)}>
                          <label><span className="sr-only">Candidate name</span><input aria-label="Candidate name" name="name" defaultValue={candidate.name} maxLength={80} required /></label>
                          <label className="candidate-description-field"><span className="sr-only">Candidate description</span><input aria-label="Candidate description" name="description" defaultValue={candidate.description} maxLength={1000} placeholder="Short description" /></label>
                          <button className="icon-button save-candidate" type="submit" title="Save candidate" aria-label="Save candidate" disabled={pendingId === candidate.id}><Save size={15} /></button>
                          <button className="icon-button remove-candidate" type="button" title="Remove candidate" aria-label={`Remove ${candidate.name}`} disabled={pendingId === candidate.id || election.candidates.length <= 2} onClick={() => void removeCandidate(election.id, candidate.id)}><Trash2 size={15} /></button>
                        </form>
                      ) : (
                        <div className="candidate-readonly" key={candidate.id}>
                          <span className="candidate-order">{(candidate.sortOrder + 1).toString().padStart(2, "0")}</span>
                          <span className="candidate-readonly-name">
                            {candidate.name}
                            <small>{candidate.description || "No description"}</small>
                          </span>
                        </div>
                      )
                    )}
                  </div>

                  {election.status === "DRAFT" && (
                    <form className="candidate-add" onSubmit={(event) => addCandidate(event, election.id)}>
                      <input aria-label="New candidate name" name="name" required minLength={2} maxLength={80} placeholder="Candidate name" />
                      <input aria-label="New candidate description" name="description" maxLength={1000} placeholder="Short description" />
                      <button className="secondary-button" type="submit" disabled={pendingId === election.id || election.candidates.length >= 20}>
                        <CirclePlus size={14} />Add candidate
                      </button>
                    </form>
                  )}

                  <div style={{ marginTop: "1rem", padding: "0.85rem", background: "rgba(255, 255, 255, 0.03)", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <UsersRound size={15} style={{ color: "#10b981" }} />
                        <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Official Class Voter List (CSV)</span>
                      </div>
                      <label className="secondary-button" style={{ fontSize: "0.75rem", padding: "0.3rem 0.65rem", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                        <Upload size={13} />
                        <span>{uploadingId === election.id ? "Uploading..." : "Upload Class CSV"}</span>
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          style={{ display: "none" }}
                          disabled={uploadingId === election.id}
                          onChange={(e) => void handleCsvUpload(election.id, e.target.files?.[0])}
                        />
                      </label>
                    </div>
                    <p style={{ fontSize: "0.75rem", color: "var(--muted, #888)", margin: "0.4rem 0 0" }}>
                      CSV format: <code>student_id,email</code>. Only officially enrolled <code>@psgtech.ac.in</code> students are eligible.
                    </p>
                  </div>

                  <div className="record-footer" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
                    <span>{statusCopy[election.status] ?? "Lifecycle status is being managed."}</span>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      {/* Close Election Early action button */}
                      {isActive && (
                        <button
                          type="button"
                          className="secondary-button"
                          style={{ borderColor: "#f59e0b", color: "#d97706", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                          title="Close election immediately ahead of schedule"
                          onClick={() => setClosingElection(election)}
                        >
                          <StopCircle size={14} />
                          Close Election Now
                        </button>
                      )}

                      {/* Advance action button */}
                      {transition && (
                        <button
                          className="transition-button"
                          type="button"
                          disabled={!canAdvance || pendingId === election.id}
                          onClick={() => void advanceElection(election)}
                        >
                          {pendingId === election.id ? "Saving..." : transition.label}
                          <ArrowUpRight size={14} />
                        </button>
                      )}

                      {/* Delete Election button */}
                      {!isVoted ? (
                        <button
                          type="button"
                          className="secondary-button"
                          style={{ borderColor: "#ef4444", color: "#dc2626", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                          title="Delete unvoted election"
                          onClick={() => {
                            setDeletingElection(election);
                            setDeleteConfirmText("");
                          }}
                        >
                          <Trash2 size={13} />
                          Delete
                        </button>
                      ) : (
                        <span
                          title="This election cannot be deleted because it contains recorded votes. To preserve blockchain audit trail, close election instead."
                          style={{
                            fontSize: "0.75rem",
                            color: "var(--muted, #888)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.25rem",
                            padding: "0.2rem 0.5rem",
                            border: "1px dashed rgba(255,255,255,0.15)",
                            borderRadius: "4px",
                          }}
                        >
                          <ShieldAlert size={12} />
                          Protected ({voteCount} votes)
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Modal: Close Election Early Confirmation */}
        {closingElection && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 100,
              padding: "1rem",
            }}
          >
            <div
              style={{
                background: "var(--paper, #18221e)",
                border: "1px solid #d97706",
                borderRadius: "8px",
                maxWidth: "480px",
                width: "100%",
                padding: "1.5rem",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: "#d97706" }}>
                <AlertTriangle size={22} />
                <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700 }}>Close Election Ahead of Schedule?</h3>
              </div>
              <p style={{ margin: "1rem 0 0.5rem", fontSize: "0.875rem", lineHeight: 1.5 }}>
                You are about to immediately close <strong>{closingElection.name}</strong> (ID: <code>{closingElection.id.slice(0, 10)}...</code>).
              </p>
              <div
                style={{
                  background: "rgba(217, 119, 6, 0.1)",
                  border: "1px solid rgba(217, 119, 6, 0.3)",
                  borderRadius: "6px",
                  padding: "0.75rem",
                  margin: "0.75rem 0",
                  fontSize: "0.8rem",
                  color: "#d97706",
                }}
              >
                <strong>Important Consequence:</strong>
                <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.2rem" }}>
                  <li>Voting will halt immediately. All subsequent ballots will be rejected.</li>
                  <li>All <strong>{closingElection.votesCount ?? 0} cast vote(s)</strong> and blockchain commitments will be preserved.</li>
                  <li>This election <strong>CANNOT be reopened</strong> once closed.</li>
                </ul>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.5rem" }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setClosingElection(null)}
                  disabled={actionInProgress}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-button"
                  style={{ background: "#d97706", borderColor: "#b45309" }}
                  onClick={() => void executeEarlyClose()}
                  disabled={actionInProgress}
                >
                  {actionInProgress ? "Closing Election..." : "Yes, Close Election Now"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Delete Election Confirmation */}
        {deletingElection && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 100,
              padding: "1rem",
            }}
          >
            <div
              style={{
                background: "var(--paper, #18221e)",
                border: "1px solid #ef4444",
                borderRadius: "8px",
                maxWidth: "480px",
                width: "100%",
                padding: "1.5rem",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: "#ef4444" }}>
                <Trash2 size={22} />
                <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700 }}>Confirm Election Deletion</h3>
              </div>
              <p style={{ margin: "1rem 0 0.5rem", fontSize: "0.875rem", lineHeight: 1.5 }}>
                You are about to permanently delete <strong>{deletingElection.name}</strong>.
              </p>
              <p style={{ fontSize: "0.8rem", color: "var(--muted, #888)", margin: "0.25rem 0 0.75rem" }}>
                Election ID: <code>{deletingElection.id}</code> · Recorded Votes: <strong>{deletingElection.votesCount ?? 0}</strong>
              </p>
              <div
                style={{
                  background: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  borderRadius: "6px",
                  padding: "0.75rem",
                  margin: "0.75rem 0",
                  fontSize: "0.8rem",
                  color: "#ef4444",
                }}
              >
                This election has 0 recorded votes and can be safely purged. This will delete all candidates and configuration. This action cannot be reversed.
              </div>
              <label style={{ display: "block", margin: "1rem 0 0.5rem", fontSize: "0.8rem" }}>
                <span>Type <strong>DELETE</strong> to confirm:</span>
                <input
                  type="text"
                  placeholder="DELETE"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  style={{
                    width: "100%",
                    height: "36px",
                    padding: "0 0.5rem",
                    marginTop: "0.35rem",
                    borderRadius: "4px",
                    border: "1px solid #ef4444",
                    background: "transparent",
                    color: "inherit",
                  }}
                />
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.25rem" }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setDeletingElection(null);
                    setDeleteConfirmText("");
                  }}
                  disabled={actionInProgress}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-button"
                  style={{
                    background: "#dc2626",
                    borderColor: "#b91c1c",
                    opacity: deleteConfirmText !== "DELETE" ? 0.4 : 1,
                    cursor: deleteConfirmText !== "DELETE" ? "not-allowed" : "pointer",
                  }}
                  disabled={actionInProgress || deleteConfirmText !== "DELETE"}
                  onClick={() => void executeDeleteElection()}
                >
                  {actionInProgress ? "Deleting..." : "Permanently Delete"}
                </button>
              </div>
            </div>
          </div>
        )}

        <footer className="elections-page-footer">
          <span>VOTECHAIN · ADMIN WORKSPACE</span>
          <Link href="/">Back to overview <ChevronDown size={13} /></Link>
        </footer>
      </section>
    </main>
  );
}