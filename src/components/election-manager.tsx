"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ElectionRecord } from "@/lib/election-types";
import {
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
  Trash2,
  UsersRound,
  X,
} from "lucide-react";

type ElectionStatus = ElectionRecord["status"];
type Election = ElectionRecord;
type ElectionManagerProps = { displayName: string; initialElections: ElectionRecord[] };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json() as T & { error?: string };
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
  const initials = displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();

  async function loadElections() {
    try {
      const result = await requestJson<{ elections: Election[] }>("/api/admin/elections");
      setElections(result.elections);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load elections.");
    }
  }

  async function createElection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSaving(true);
    setError("");
    setMessage("");
    const form = new FormData(formElement);
    const candidateLines = String(form.get("candidates") ?? "").split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
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
      setMessage(`Election moved to ${statusName(election.status === "DRAFT" ? "UPCOMING" : election.status === "UPCOMING" ? "ACTIVE" : election.status === "ACTIVE" ? "CLOSED" : "RESULTS_PUBLISHED").toLowerCase()}.`);
      await loadElections();
    } catch (transitionError) {
      setError(transitionError instanceof Error ? transitionError.message : "Could not change election status.");
    } finally {
      setPendingId("");
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
          <div><p className="eyebrow">ADMINISTRATION / PHASE 3</p><h1>Elections</h1><p className="page-subtitle">Create the election, lock candidates, monitor voting, and publish verification-ready results.</p></div>
          <button className="primary-button" onClick={() => { setFormOpen((open) => !open); setError(""); }}>
            {formOpen ? <X size={16} /> : <CirclePlus size={16} />}{formOpen ? "Close form" : "New election"}
          </button>
        </div>

        <div className="election-safety-note"><LockKeyhole size={16} /><p><strong>Configuration locks before voting.</strong> Candidate details can only be changed while an election is a draft. This Phase 3 prototype handles ballots, receipts, and verification outputs.</p></div>
        {error && <div className="election-feedback feedback-error" role="alert"><CircleAlert size={16} />{error}<button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
        {message && <div className="election-feedback feedback-success" role="status"><Check size={16} />{message}<button onClick={() => setMessage("")} aria-label="Dismiss message"><X size={15} /></button></div>}

        {formOpen && <section className="election-create-panel" id="new-election">
          <div className="form-section-heading"><div><span className="panel-kicker">NEW ELECTION</span><h2>Election setup</h2></div><span className="draft-label">SAVED AS DRAFT</span></div>
          <form className="election-form" onSubmit={createElection}>
            <label className="field-block"><span>Election name</span><input name="name" required minLength={3} maxLength={120} placeholder="e.g. Student Council 2027" /></label>
            <label className="field-block"><span>Description <small>Optional</small></span><textarea name="description" maxLength={2000} rows={2} placeholder="What is this election for?" /></label>
            <div className="schedule-fields">
              <label className="field-block"><span>Starts <small>Local time</small></span><input name="startTime" type="datetime-local" required /></label>
              <label className="field-block"><span>Ends <small>Local time</small></span><input name="endTime" type="datetime-local" required /></label>
            </div>
            <label className="field-block"><span>Candidates <small>One name per line · 2 to 20</small></span><textarea name="candidates" required rows={4} placeholder={'Jordan Miller\nRiley Kim\nAvery Singh'} /></label>
            <label className="field-block"><span>Eligible voter IDs <small>Optional; comma-separated user IDs for registry enforcement</small></span><input name="eligibleVoterIds" placeholder="user-1, user-2, user-3" /></label>
            <div className="election-form-footer"><span>Schedule values are stored as UTC instants.</span><button className="primary-button" type="submit" disabled={saving}>{saving ? "Creating..." : "Create draft"}<ArrowUpRight size={15} /></button></div>
          </form>
        </section>}

        <div className="election-list-heading"><div><h2>Election register</h2><p>Lifecycle actions are checked by the server against the configured schedule.</p></div><span className="election-total">{elections.length.toString().padStart(2, "0")} TOTAL</span></div>
        {elections.length === 0 ? <div className="election-empty"><CalendarClock size={21} /><strong>No elections created</strong><span>Start with a draft and lock its candidate list when the configuration is ready.</span><button className="text-button" onClick={() => setFormOpen(true)}>Create first election <ArrowUpRight size={14} /></button></div> :
          <div className="election-record-list">{elections.map((election) => {
            const transition = nextAction[election.status];
            const canAdvance = election.status !== "RESULTS_PUBLISHED" && (election.status !== "DRAFT" || election.candidates.length >= 2);
            return <article className="election-record" key={election.id}>
              <div className="record-heading"><div><span className="record-id">{election.id}</span><h3>{election.name}</h3>{election.description && <p className="record-description">{election.description}</p>}</div><span className={`election-status status-${election.status.toLowerCase()}`}><i />{statusName(election.status)}</span></div>
              <div className="record-metadata"><span><CalendarClock size={14} /><span>START</span><strong>{formatTime(election.startTime)}</strong></span><span><CalendarClock size={14} /><span>END</span><strong>{formatTime(election.endTime)}</strong></span><span><UsersRound size={14} /><span>CANDIDATES</span><strong>{election.candidates.length.toString().padStart(2, "0")}</strong></span></div>
              <div className="record-candidate-heading"><strong>Candidate list</strong><span>{election.candidatesLocked ? <><LockKeyhole size={12} /> LOCKED</> : "DRAFT · EDITABLE"}</span></div>
              <div className="record-candidates">{election.candidates.map((candidate) => election.status === "DRAFT" && !election.candidatesLocked ? <form className="candidate-edit" key={candidate.id} onSubmit={(event) => updateCandidate(event, election.id, candidate.id)}>
                <label><span className="sr-only">Candidate name</span><input aria-label="Candidate name" name="name" defaultValue={candidate.name} maxLength={80} required /></label>
                <label className="candidate-description-field"><span className="sr-only">Candidate description</span><input aria-label="Candidate description" name="description" defaultValue={candidate.description} maxLength={1000} placeholder="Short description" /></label>
                <button className="icon-button save-candidate" type="submit" title="Save candidate" aria-label="Save candidate" disabled={pendingId === candidate.id}><Save size={15} /></button>
                <button className="icon-button remove-candidate" type="button" title="Remove candidate" aria-label={`Remove ${candidate.name}`} disabled={pendingId === candidate.id || election.candidates.length <= 2} onClick={() => void removeCandidate(election.id, candidate.id)}><Trash2 size={15} /></button>
              </form> : <div className="candidate-readonly" key={candidate.id}><span className="candidate-order">{(candidate.sortOrder + 1).toString().padStart(2, "0")}</span><span className="candidate-readonly-name">{candidate.name}<small>{candidate.description || "No description"}</small></span></div>)}</div>
              {election.status === "DRAFT" && <form className="candidate-add" onSubmit={(event) => addCandidate(event, election.id)}>
                <input aria-label="New candidate name" name="name" required minLength={2} maxLength={80} placeholder="Candidate name" />
                <input aria-label="New candidate description" name="description" maxLength={1000} placeholder="Short description" />
                <button className="secondary-button" type="submit" disabled={pendingId === election.id || election.candidates.length >= 20}><CirclePlus size={14} />Add candidate</button>
              </form>}
              <div className="record-footer">
                <span>{statusCopy[election.status] ?? "Lifecycle status is being managed."}</span>
                {transition && (
                  <button className="transition-button" type="button" disabled={!canAdvance || pendingId === election.id} onClick={() => void advanceElection(election)}>
                    {pendingId === election.id ? "Saving..." : transition.label}
                    <ArrowUpRight size={14} />
                  </button>
                )}
              </div>
            </article>;
          })}</div>}
        <footer className="elections-page-footer"><span>VOTECHAIN · ADMIN WORKSPACE</span><Link href="/">Back to overview <ChevronDown size={13} /></Link></footer>
      </section>
    </main>
  );
}