"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Blocks,
  Check,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  ClipboardList,
  Fingerprint,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  StopCircle,
  Trash2,
  UserPlus,
  UsersRound,
  Vote,
  X,
} from "lucide-react";

export type UserItem = {
  id: string;
  voterId: string | null;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
};

export type AuthorityItem = {
  id: string;
  authorityIndex: number;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
};

export type DashboardElectionItem = {
  id: string;
  name: string;
  description: string;
  status: string;
  startTime: string;
  endTime: string;
  candidatesCount: number;
  votesCount: number;
};

export type DashboardMetrics = {
  votersCount: number;
  activeElectionsCount: number;
  totalVotes: number;
  participationRate: number;
  authoritiesCount: number;
  activeElection: {
    id: string;
    name: string;
    description: string;
    candidatesCount: number;
    candidates: Array<{ id: string; name: string; description: string; sortOrder: number }>;
    votesCount: number;
    endTime: string;
  } | null;
};

export type ActivityItem = {
  time: string;
  title: string;
  detail: string;
  tag: string;
  color: string;
};

type DashboardProps = {
  displayName: string;
  role: string;
  metrics: DashboardMetrics;
  recentActivities: ActivityItem[];
  initialUsers: UserItem[];
  initialAuthorities: AuthorityItem[];
  initialElections: DashboardElectionItem[];
};

const navigation = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Authorities", icon: ShieldCheck },
  { label: "Elections", icon: Vote, href: "/elections" },
  { label: "Voters", icon: UsersRound },
  { label: "Ledger", icon: Blocks, href: "/results" },
  { label: "Audit trail", icon: ClipboardList, href: "/audit" },
];

export default function DashboardClient({
  displayName,
  role,
  metrics,
  recentActivities,
  initialUsers,
  initialAuthorities,
  initialElections,
}: DashboardProps) {
  const router = useRouter();
  const [activeNav, setActiveNav] = useState("Overview");
  const [noticeOpen, setNoticeOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Data states
  const [users, setUsers] = useState<UserItem[]>(initialUsers);
  const [authorities, setAuthorities] = useState<AuthorityItem[]>(initialAuthorities);
  const [elections, setElections] = useState<DashboardElectionItem[]>(initialElections);

  // Voter Enrollment Form state
  const [showVoterModal, setShowVoterModal] = useState(false);
  const [voterFormSubmitting, setVoterFormSubmitting] = useState(false);
  const [voterFormError, setVoterFormError] = useState("");
  const [voterFormSuccess, setVoterFormSuccess] = useState("");

  // Authority Invitation Form state
  const [showAuthorityModal, setShowAuthorityModal] = useState(false);
  const [authoritySubmitting, setAuthoritySubmitting] = useState(false);
  const [authorityError, setAuthorityError] = useState("");
  const [authoritySuccess, setAuthoritySuccess] = useState("");

  // Election Quick Action Modals
  const [closingElection, setClosingElection] = useState<DashboardElectionItem | null>(null);
  const [deletingElection, setDeletingElection] = useState<DashboardElectionItem | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [actionInProgress, setActionInProgress] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");
  const [globalError, setGlobalError] = useState("");

  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  async function reloadAuthorities() {
    try {
      const res = await fetch("/api/admin/authorities");
      if (res.ok) {
        const data = await res.json();
        setAuthorities(data.authorities || []);
      }
    } catch {
      // ignore reload error
    }
  }

  async function reloadElections() {
    try {
      const res = await fetch("/api/admin/elections");
      if (res.ok) {
        const data = await res.json();
        const mapped: DashboardElectionItem[] = (data.elections || []).map((e: any) => ({
          id: e.id,
          name: e.name,
          description: e.description || "",
          status: e.status,
          startTime: e.startTime,
          endTime: e.endTime,
          candidatesCount: e.candidates?.length || 0,
          votesCount: e.votesCount ?? 0,
        }));
        setElections(mapped);
      }
    } catch {
      // ignore reload error
    }
  }

  async function handleRegisterVoter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setVoterFormError("");
    setVoterFormSuccess("");
    setVoterFormSubmitting(true);
    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          voterId: form.get("voterId"),
          password: form.get("password"),
          role: form.get("role") || "VOTER",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to register voter.");

      setUsers((prev) => [data.user, ...prev]);
      setVoterFormSuccess(`Registered ${data.user.name} (${data.user.email}) successfully!`);
      e.currentTarget.reset();
    } catch (err) {
      setVoterFormError(err instanceof Error ? err.message : "Error creating voter.");
    } finally {
      setVoterFormSubmitting(false);
    }
  }

  async function handleCreateAuthority(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthorityError("");
    setAuthoritySuccess("");
    setAuthoritySubmitting(true);
    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/admin/authorities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create authority.");

      setAuthoritySuccess(
        `Authority Trustee #${data.authority.authorityIndex} (${data.authority.name}) created successfully!`
      );
      await reloadAuthorities();
      e.currentTarget.reset();
      setTimeout(() => setShowAuthorityModal(false), 1500);
    } catch (err) {
      setAuthorityError(err instanceof Error ? err.message : "Error creating authority.");
    } finally {
      setAuthoritySubmitting(false);
    }
  }

  async function handleRemoveAuthority(authorityId: string, name: string) {
    if (!confirm(`Are you sure you want to remove authority trustee "${name}"?`)) return;
    setGlobalError("");
    setGlobalMessage("");
    try {
      const res = await fetch(`/api/admin/authorities/${authorityId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove authority.");
      setGlobalMessage(data.message || `Authority "${name}" removed.`);
      await reloadAuthorities();
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Error removing authority.");
    }
  }

  async function executeEarlyClose() {
    if (!closingElection) return;
    setActionInProgress(true);
    setGlobalError("");
    setGlobalMessage("");
    try {
      const res = await fetch(`/api/admin/elections/${closingElection.id}/close`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to close election.");
      setGlobalMessage(`Election "${closingElection.name}" closed early. Voting has halted.`);
      setClosingElection(null);
      await reloadElections();
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Failed to close election early.");
    } finally {
      setActionInProgress(false);
    }
  }

  async function executeDeleteElection() {
    if (!deletingElection) return;
    setActionInProgress(true);
    setGlobalError("");
    setGlobalMessage("");
    try {
      const res = await fetch(`/api/admin/elections/${deletingElection.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete election.");
      setGlobalMessage(`Election "${deletingElection.name}" was permanently deleted.`);
      setDeletingElection(null);
      setDeleteConfirmText("");
      await reloadElections();
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Failed to delete election.");
    } finally {
      setActionInProgress(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <Link className="brand" href="/" aria-label="VoteChain home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </Link>
        <div className="workspace-switcher">
          <span className="workspace-icon">VC</span>
          <span className="workspace-copy"><strong>VoteChain Admin</strong><small>Security Console</small></span>
          <ChevronDown size={15} aria-hidden="true" />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav className="primary-nav" aria-label="Main navigation">
          {navigation.map(({ label, icon: Icon, href }) => {
            const className = `nav-item ${activeNav === label ? "nav-active" : ""}`;
            const content = (
              <>
                <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                <span>{label}</span>
              </>
            );
            return href ? (
              <Link
                key={label}
                className={className}
                href={href}
                onClick={() => {
                  setActiveNav(label);
                  setMobileNavOpen(false);
                }}
              >
                {content}
              </Link>
            ) : (
              <button
                key={label}
                className={className}
                onClick={() => {
                  setActiveNav(label);
                  setMobileNavOpen(false);
                }}
              >
                {content}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-help"><CircleHelp size={17} /><span>Project guide</span><ArrowUpRight size={14} /></div>
          <div className="user-profile">
            <div className="avatar">{initials}</div>
            <span className="profile-copy"><strong>{displayName}</strong><small>{role}</small></span>
            <button className="icon-button profile-menu" title="Sign out" aria-label="Sign out" onClick={signOut}><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <section className="main-column" id="overview">
        <header className="topbar">
          <button className="icon-button mobile-menu" title="Open navigation" aria-label="Open navigation" onClick={() => setMobileNavOpen(!mobileNavOpen)}>
            {mobileNavOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{activeNav}</strong></div>
          <div className="topbar-actions">
            <button className="search-button" aria-label="Search"><Search size={16} /><span>Search</span><kbd>⌘ K</kbd></button>
            <button className="icon-button notification-button" title="Notifications" aria-label="Notifications"><Bell size={18} /><i /></button>
            <span className="topbar-divider" />
            <div className="topbar-date"><span className="live-dot" /> LIVE SYSTEM</div>
          </div>
        </header>

        <div className="content-wrap">
          {globalMessage && (
            <div className="election-feedback feedback-success" role="status" style={{ marginBottom: "1rem" }}>
              <Check size={16} />{globalMessage}
              <button onClick={() => setGlobalMessage("")} aria-label="Dismiss message"><X size={15} /></button>
            </div>
          )}
          {globalError && (
            <div className="election-feedback feedback-error" role="alert" style={{ marginBottom: "1rem" }}>
              <CircleAlert size={16} />{globalError}
              <button onClick={() => setGlobalError("")} aria-label="Dismiss error"><X size={15} /></button>
            </div>
          )}

          {activeNav === "Authorities" ? (
            /* ======================================================== */
            /* AUTHORITIES MANAGEMENT TAB (2-OF-3 THRESHOLD SYSTEM)     */
            /* ======================================================== */
            <div style={{ marginTop: "1rem" }}>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">ADMINISTRATION / 2-OF-3 THRESHOLD TRUSTEES</p>
                  <h1>Election Authority Trustees</h1>
                  <p className="page-subtitle">
                    Manage the 3 designated authority accounts holding Shamir key shares. A 2-of-3 threshold is required to tally and decrypt election results.
                  </p>
                </div>
                {authorities.length < 3 ? (
                  <button
                    className="primary-button"
                    onClick={() => {
                      setShowAuthorityModal(!showAuthorityModal);
                      setAuthorityError("");
                      setAuthoritySuccess("");
                    }}
                  >
                    <KeyRound size={16} /> {showAuthorityModal ? "Close Form" : "Add Authority Trustee"}
                  </button>
                ) : (
                  <span
                    style={{
                      fontSize: "0.8rem",
                      color: "#10b981",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      padding: "0.4rem 0.8rem",
                      background: "rgba(16, 185, 129, 0.1)",
                      border: "1px solid rgba(16, 185, 129, 0.3)",
                      borderRadius: "6px",
                      fontWeight: 600,
                    }}
                  >
                    <Check size={15} /> All 3 Trustee Slots Assigned
                  </span>
                )}
              </div>

              {/* Threshold Cryptography Status Banner */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.85rem 1rem",
                  borderRadius: "6px",
                  border: `1px solid ${authorities.length === 3 ? "rgba(16, 185, 129, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
                  background: authorities.length === 3 ? "rgba(16, 185, 129, 0.08)" : "rgba(245, 158, 11, 0.08)",
                  margin: "1rem 0 1.5rem",
                }}
              >
                {authorities.length === 3 ? (
                  <ShieldCheck size={20} color="#10b981" />
                ) : (
                  <AlertTriangle size={20} color="#f59e0b" />
                )}
                <div style={{ flex: 1, fontSize: "0.85rem" }}>
                  <strong>
                    {authorities.length === 3
                      ? "2-of-3 Threshold Operational (3 of 3 Authorities Configured)"
                      : `Incomplete Authority Setup (${authorities.length} of 3 Configured)`}
                  </strong>
                  <p style={{ margin: "0.2rem 0 0", fontSize: "0.775rem", color: "var(--muted, #888)" }}>
                    {authorities.length === 3
                      ? "Key reconstruction requires any 2 distinct authorized key shares. Authority accounts are strictly isolated from voter roles."
                      : "The cryptographic threshold protocol requires exactly 3 distinct trustees. Please add the remaining trustee account(s)."}
                  </p>
                </div>
              </div>

              {/* Add Authority Form Panel */}
              {showAuthorityModal && authorities.length < 3 && (
                <div className="election-create-panel" style={{ marginTop: "1rem" }}>
                  <div className="form-section-heading">
                    <div>
                      <span className="panel-kicker">TRUSTEE ENROLLMENT · SLOT #{authorities.length + 1}</span>
                      <h2>Add Election Authority Account</h2>
                    </div>
                  </div>
                  {authorityError && <div className="election-feedback feedback-error">{authorityError}</div>}
                  {authoritySuccess && <div className="election-feedback feedback-success">{authoritySuccess}</div>}
                  <form className="election-form" onSubmit={handleCreateAuthority}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                      <label className="field-block">
                        <span>Full Name</span>
                        <input name="name" required minLength={2} maxLength={80} placeholder="e.g. Dr. Eleanor Vance" />
                      </label>
                      <label className="field-block">
                        <span>Email Address</span>
                        <input name="email" type="email" required placeholder="e.g. trustee@votechain.local" />
                      </label>
                    </div>
                    <label className="field-block">
                      <span>Temporary Password (min 8 chars)</span>
                      <input name="password" type="password" required minLength={8} placeholder="••••••••••••" />
                    </label>
                    <div className="election-form-footer">
                      <span>Authority accounts will be pre-verified and assigned to Slot #{authorities.length + 1}.</span>
                      <button className="primary-button" type="submit" disabled={authoritySubmitting}>
                        {authoritySubmitting ? "Creating Trustee..." : "Create Authority Account"}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* 3 Authority Slots Display */}
              <div style={{ marginTop: "1.5rem" }}>
                <div className="election-list-heading">
                  <div>
                    <h2>Designated Authority Slots (2-of-3 Custody)</h2>
                    <p>Each slot holds 1 Shamir secret share for modern election tally decryption.</p>
                  </div>
                  <span className="election-total">{authorities.length} / 3 ASSIGNED</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
                  {[1, 2, 3].map((slotIndex) => {
                    const auth = authorities[slotIndex - 1];
                    return (
                      <div
                        key={slotIndex}
                        style={{
                          border: "1px solid var(--line, #2d3748)",
                          borderRadius: "8px",
                          padding: "1.25rem",
                          background: auth ? "var(--paper, #1a202c)" : "rgba(255, 255, 255, 0.02)",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          minHeight: "160px",
                        }}
                      >
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                            <span
                              style={{
                                fontSize: "0.75rem",
                                fontWeight: 700,
                                padding: "0.2rem 0.5rem",
                                borderRadius: "4px",
                                background: auth ? "rgba(16, 185, 129, 0.15)" : "rgba(255, 255, 255, 0.08)",
                                color: auth ? "#10b981" : "var(--muted, #888)",
                              }}
                            >
                              SLOT {slotIndex}: AUTHORITY {slotIndex}
                            </span>
                            <span
                              className={`election-status ${auth ? "status-active" : "status-draft"}`}
                              style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem" }}
                            >
                              <i /> {auth ? auth.status : "VACANT"}
                            </span>
                          </div>

                          {auth ? (
                            <div>
                              <strong style={{ fontSize: "1rem", display: "block" }}>{auth.name}</strong>
                              <span style={{ fontSize: "0.8rem", color: "var(--muted, #888)", display: "block", marginTop: "0.2rem" }}>
                                {auth.email}
                              </span>
                              <div style={{ fontSize: "0.75rem", color: "var(--muted, #888)", marginTop: "0.5rem" }}>
                                Enrolled: {new Date(auth.createdAt).toLocaleDateString()} · Role: <strong>{auth.role}</strong>
                              </div>
                            </div>
                          ) : (
                            <div style={{ color: "var(--muted, #888)", fontSize: "0.85rem", padding: "0.5rem 0" }}>
                              Unassigned Trustee Position.
                              <div style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
                                Click &quot;Add Authority Trustee&quot; above to fill this slot.
                              </div>
                            </div>
                          )}
                        </div>

                        {auth && (
                          <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(255, 255, 255, 0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "0.7rem", color: "#10b981", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                              <ShieldCheck size={12} /> Key Share Holder
                            </span>
                            <button
                              type="button"
                              className="secondary-button"
                              style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", borderColor: "#ef4444", color: "#dc2626" }}
                              onClick={() => handleRemoveAuthority(auth.id, auth.name)}
                            >
                              <Trash2 size={12} /> Remove
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : activeNav === "Voters" ? (
            /* ======================================================== */
            /* VOTER REGISTRATION REGISTER TAB                          */
            /* ======================================================== */
            <div style={{ marginTop: "1rem" }}>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">ADMINISTRATION / VOTER REGISTER</p>
                  <h1>Voter Registration Register</h1>
                  <p className="page-subtitle">Register and manage eligible voters with Voter ID, email, and role authorization.</p>
                </div>
                <button className="primary-button" onClick={() => setShowVoterModal(!showVoterModal)}>
                  <UserPlus size={16} /> {showVoterModal ? "Close Form" : "Register New Voter"}
                </button>
              </div>

              {showVoterModal && (
                <div className="election-create-panel" style={{ marginTop: "1.5rem" }}>
                  <div className="form-section-heading">
                    <div>
                      <span className="panel-kicker">NEW VOTER ENROLLMENT</span>
                      <h2>Add eligible voter account</h2>
                    </div>
                  </div>
                  {voterFormError && <div className="election-feedback feedback-error">{voterFormError}</div>}
                  {voterFormSuccess && <div className="election-feedback feedback-success">{voterFormSuccess}</div>}
                  <form className="election-form" onSubmit={handleRegisterVoter}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                      <label className="field-block">
                        <span>Full Name</span>
                        <input name="name" required minLength={2} placeholder="e.g. Eleanor Vance" />
                      </label>
                      <label className="field-block">
                        <span>Voter ID</span>
                        <input name="voterId" required placeholder="e.g. VTR-2026-089" />
                      </label>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                      <label className="field-block">
                        <span>Email Address</span>
                        <input name="email" type="email" required placeholder="e.g. eleanor@college.edu" />
                      </label>
                      <label className="field-block">
                        <span>Password (min 8 chars)</span>
                        <input name="password" type="password" required minLength={8} placeholder="••••••••••••" />
                      </label>
                    </div>
                    <label className="field-block">
                      <span>Role</span>
                      <select name="role" defaultValue="VOTER" style={{ background: "transparent", color: "inherit", padding: "0.5rem", borderRadius: "4px" }}>
                        <option value="VOTER">VOTER (Eligible Ballot Cast)</option>
                        <option value="OBSERVER">OBSERVER (Read-Only Audit Monitor)</option>
                      </select>
                    </label>
                    <div className="election-form-footer">
                      <span>Password will be securely hashed with Bcrypt (cost factor 12).</span>
                      <button className="primary-button" type="submit" disabled={voterFormSubmitting}>
                        {voterFormSubmitting ? "Enrolling..." : "Enroll Voter"}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              <div className="election-record-list" style={{ marginTop: "2rem" }}>
                <div className="election-list-heading">
                  <div>
                    <h2>Enrolled Voters & Users</h2>
                    <p>{users.length} total enrolled accounts</p>
                  </div>
                </div>
                <div className="record-candidates" style={{ marginTop: "1rem" }}>
                  {users.map((u) => (
                    <div key={u.id} className="candidate-readonly" style={{ justifyContent: "space-between" }}>
                      <div>
                        <strong>{u.name}</strong> <small>({u.email})</small>
                        <div style={{ fontSize: "0.75rem", color: "var(--muted, #888)", marginTop: "0.2rem" }}>
                          Voter ID: <code>{u.voterId || "N/A"}</code> · Role: <strong>{u.role}</strong>
                        </div>
                      </div>
                      <span className="election-status status-active">
                        <i />{u.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* ======================================================== */
            /* MAIN DASHBOARD OVERVIEW (ELECTIONS & METRICS)            */
            /* ======================================================== */
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">ONLINE VOTING PROTOTYPE <span>•</span> SYSTEM CONSOLE</p>
                  <h1>Election overview</h1>
                  <p className="page-subtitle">Real-time cryptographic auditability, zero-knowledge verification, and blockchain commitments.</p>
                </div>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button className="secondary-button" onClick={() => setActiveNav("Authorities")}>
                    <ShieldCheck size={16} /> Manage Authorities ({authorities.length}/3)
                  </button>
                  <button className="primary-button" onClick={() => router.push("/elections")}>
                    <Plus size={17} /> Create election
                  </button>
                </div>
              </div>

              {noticeOpen && (
                <div className="prototype-notice">
                  <div className="notice-icon"><Fingerprint size={18} /></div>
                  <p>
                    <strong>VoteChain Security Architecture:</strong>
                    <span> 2-of-3 threshold authority decryption, ZK candidate validity proofs, and Sepolia Ethereum audit commitments.</span>
                  </p>
                  <button className="icon-button notice-close" aria-label="Dismiss notice" title="Dismiss notice" onClick={() => setNoticeOpen(false)}>
                    <X size={16} />
                  </button>
                </div>
              )}

              {/* 4-Panel Metrics Grid */}
              <section className="metrics-grid" aria-label="Election metrics" style={{ gridTemplateColumns: "1.2fr 1fr 1fr" }}>
                <article className="metric-panel metric-primary">
                  <div className="metric-top"><span>ACTIVE ELECTION</span><span className="status-pill"><i /> LIVE</span></div>
                  <h2>{metrics.activeElection?.name ?? "No Active Election"}</h2>
                  <div className="metric-foot">
                    <span>{metrics.activeElection ? `Closes: ${new Date(metrics.activeElection.endTime).toLocaleDateString()}` : "Create an election to begin"}</span>
                    <button onClick={() => router.push("/elections")}>Manage <ArrowUpRight size={14} /></button>
                  </div>
                  <div className="panel-grid" aria-hidden="true" />
                </article>

                <article className="metric-panel">
                  <div className="metric-top"><span>REGISTERED VOTERS</span><span className="metric-icon green-icon"><UsersRound size={17} /></span></div>
                  <div className="metric-value">{metrics.votersCount}</div>
                  <div className="metric-change">
                    <span className="change-up"><ArrowUpRight size={14} /> {metrics.participationRate}%</span>
                    <span>turnout rate</span>
                  </div>
                  <div className="progress-track"><span style={{ width: `${Math.min(100, metrics.participationRate)}%` }} /></div>
                  <div className="metric-foot">
                    <span>{metrics.totalVotes} total votes cast</span>
                    <button onClick={() => setActiveNav("Voters")}>Voters <ArrowUpRight size={14} /></button>
                  </div>
                </article>

                <article className="metric-panel">
                  <div className="metric-top"><span>THRESHOLD TRUSTEES</span><span className="metric-icon blue-icon"><ShieldCheck size={17} /></span></div>
                  <div className="metric-value" style={{ fontSize: "28px" }}>
                    {authorities.length} <span className="metric-unit">/ 3</span>
                  </div>
                  <div className="metric-change">
                    <span style={{ color: authorities.length === 3 ? "#10b981" : "#f59e0b", fontWeight: 600 }}>
                      {authorities.length === 3 ? "2-of-3 Ready" : "Setup Incomplete"}
                    </span>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: `${(authorities.length / 3) * 100}%`, background: authorities.length === 3 ? "#10b981" : "#f59e0b" }} />
                  </div>
                  <div className="metric-foot">
                    <span>Shamir Secret Sharing</span>
                    <button onClick={() => setActiveNav("Authorities")}>Trustees <ArrowUpRight size={14} /></button>
                  </div>
                </article>
              </section>

              {/* Elections Quick Control Section */}
              <section style={{ marginTop: "2rem" }}>
                <div className="election-list-heading">
                  <div>
                    <h2>Elections Quick Control</h2>
                    <p>Directly manage status, close active voting early, or remove unvoted elections.</p>
                  </div>
                  <Link href="/elections" className="text-button">View all in manager <ArrowUpRight size={14} /></Link>
                </div>

                <div className="election-record-list" style={{ marginTop: "1rem" }}>
                  {elections.slice(0, 5).map((el) => {
                    const isVoted = el.votesCount > 0;
                    const isActive = el.status === "ACTIVE";

                    return (
                      <div
                        key={el.id}
                        style={{
                          border: "1px solid var(--line, #2d3748)",
                          borderRadius: "6px",
                          padding: "1rem 1.25rem",
                          background: "var(--paper, #1a202c)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: "1rem",
                        }}
                      >
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <strong>{el.name}</strong>
                            <span className={`election-status status-${el.status.toLowerCase()}`} style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem" }}>
                              <i /> {el.status}
                            </span>
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--muted, #888)", marginTop: "0.3rem" }}>
                            ID: <code>{el.id.slice(0, 10)}...</code> · Candidates: <strong>{el.candidatesCount}</strong> · Votes Cast: <strong>{el.votesCount}</strong>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                          {isActive && (
                            <button
                              type="button"
                              className="secondary-button"
                              style={{ borderColor: "#f59e0b", color: "#d97706", display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem" }}
                              onClick={() => setClosingElection(el)}
                            >
                              <StopCircle size={13} /> Close Election Now
                            </button>
                          )}

                          {!isVoted ? (
                            <button
                              type="button"
                              className="secondary-button"
                              style={{ borderColor: "#ef4444", color: "#dc2626", display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem" }}
                              onClick={() => {
                                setDeletingElection(el);
                                setDeleteConfirmText("");
                              }}
                            >
                              <Trash2 size={13} /> Delete
                            </button>
                          ) : (
                            <span
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
                              title="Cannot delete election with recorded votes. Audit trail is preserved."
                            >
                              <ShieldAlert size={12} /> Protected ({el.votesCount} votes)
                            </span>
                          )}

                          <button
                            type="button"
                            className="secondary-button"
                            style={{ fontSize: "0.75rem" }}
                            onClick={() => router.push("/elections")}
                          >
                            Details <ArrowUpRight size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Lower Grid: Focus Election & Audit Log */}
              <div className="lower-grid" style={{ marginTop: "2rem" }}>
                <section className="election-panel">
                  <div className="panel-header">
                    <div>
                      <span className="panel-kicker">CURRENT FOCUS</span>
                      <h3>{metrics.activeElection ? metrics.activeElection.name : "System Standby"}</h3>
                    </div>
                    <span className="status-pill status-open"><i /> {metrics.activeElection ? "ACTIVE" : "STANDBY"}</span>
                  </div>
                  {metrics.activeElection ? (
                    <>
                      <div className="election-meta">
                        <span><span className="meta-label">ELECTION ID</span><code>{metrics.activeElection.id.slice(0, 10)}...</code></span>
                        <span><span className="meta-label">CANDIDATES</span><strong>{metrics.activeElection.candidatesCount.toString().padStart(2, "0")}</strong></span>
                        <span><span className="meta-label">VOTES CAST</span><strong>{metrics.activeElection.votesCount}</strong></span>
                      </div>
                      <div className="candidate-list">
                        {metrics.activeElection.candidates.map((candidate, idx) => (
                          <div className="candidate-row" key={candidate.id}>
                            <span className="candidate-avatar candidate-one">{(idx + 1).toString().padStart(2, "0")}</span>
                            <span className="candidate-name">{candidate.name}<small>{candidate.description || "Candidate"}</small></span>
                            <span className="candidate-index">#{idx + 1}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
                        <button
                          type="button"
                          className="secondary-button"
                          style={{ borderColor: "#f59e0b", color: "#d97706", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                          onClick={() => {
                            const found = elections.find((e) => e.id === metrics.activeElection?.id);
                            if (found) setClosingElection(found);
                          }}
                        >
                          <StopCircle size={14} /> Close Now
                        </button>
                        <button className="panel-link" onClick={() => router.push("/elections")}>Open election manager <ArrowUpRight size={15} /></button>
                      </div>
                    </>
                  ) : (
                    <div style={{ padding: "1.5rem 0", color: "var(--muted, #888)" }}>
                      No election is currently in ACTIVE status. Use Elections to create and activate an election.
                    </div>
                  )}
                </section>

                <section className="activity-panel">
                  <div className="activity-heading">
                    <div><span className="panel-kicker">AUDIT LOG</span><h3>Recent system activity</h3></div>
                  </div>
                  <div className="activity-list">
                    {recentActivities.length === 0 ? (
                      <div style={{ padding: "1rem", color: "var(--muted, #888)" }}>No audit activity yet.</div>
                    ) : (
                      recentActivities.map((activity, i) => (
                        <article className="activity-row" key={i}>
                          <span className={`activity-marker marker-${activity.color}`} />
                          <div className="activity-copy">
                            <span className="activity-time">{activity.time} <i>{activity.tag}</i></span>
                            <strong>{activity.title}</strong>
                            <span className="activity-detail">{activity.detail}</span>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                  <button className="panel-link" onClick={() => router.push("/audit")}>View all activity <ArrowUpRight size={15} /></button>
                  <div className="ledger-note"><LockKeyhole size={15} /><span>Audit events are cryptographically hashed and append-oriented.</span></div>
                </section>
              </div>

              <footer className="page-footer">
                <span>VOTECHAIN <i>·</i> FULL-STACK ONLINE VOTING PROTOTYPE</span>
                <span>Privacy-Preserving Blockchain Electronic Voting System <ArrowDownRight size={13} /></span>
              </footer>
            </>
          )}
        </div>
      </section>

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
              You are about to immediately close <strong>{closingElection.name}</strong>.
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
              <strong>Immediate Effects:</strong>
              <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.2rem" }}>
                <li>Voting halts immediately. Further submissions will be rejected.</li>
                <li>All <strong>{closingElection.votesCount} cast vote(s)</strong> and blockchain commitments remain intact.</li>
                <li>This election <strong>cannot be reopened</strong> once closed.</li>
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
              Election ID: <code>{deletingElection.id}</code> · Recorded Votes: <strong>{deletingElection.votesCount}</strong>
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
              This election has 0 recorded votes and can be safely purged. This will delete all candidate lists and configuration. This action cannot be reversed.
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
    </main>
  );
}