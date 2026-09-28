"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Blocks,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Fingerprint,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  UserPlus,
  UsersRound,
  Vote,
  X,
} from "lucide-react";

const navigation = [
  { label: "Overview", icon: LayoutDashboard, href: "/" },
  { label: "Elections", icon: Vote, href: "/elections" },
  { label: "Voters", icon: UsersRound },
  { label: "Ledger", icon: Blocks, href: "/results" },
  { label: "Audit trail", icon: ClipboardList, href: "/audit" },
];

export type UserItem = {
  id: string;
  voterId: string | null;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
};

export type DashboardMetrics = {
  votersCount: number;
  activeElectionsCount: number;
  totalVotes: number;
  participationRate: number;
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
};

export default function DashboardClient({
  displayName,
  role,
  metrics,
  recentActivities,
  initialUsers,
}: DashboardProps) {
  const router = useRouter();
  const [activeNav, setActiveNav] = useState("Overview");
  const [noticeOpen, setNoticeOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [users, setUsers] = useState<UserItem[]>(initialUsers);
  const [showVoterModal, setShowVoterModal] = useState(false);
  const [voterFormSubmitting, setVoterFormSubmitting] = useState(false);
  const [voterFormError, setVoterFormError] = useState("");
  const [voterFormSuccess, setVoterFormSuccess] = useState("");

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
          {activeNav === "Voters" ? (
            /* Voter Management Tab */
            <div style={{ marginTop: "1rem" }}>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">ADMINISTRATION / SECTION 3.1</p>
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
                        <option value="AUTHORITY">AUTHORITY (Key Share Trustee)</option>
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
            /* Main Dashboard Overview */
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">ONLINE VOTING PROTOTYPE <span>•</span> SYSTEM CONSOLE</p>
                  <h1>Election overview</h1>
                  <p className="page-subtitle">Real-time cryptographic auditability, zero-knowledge verification, and blockchain commitments.</p>
                </div>
                <button className="primary-button" onClick={() => router.push("/elections")}><Plus size={17} /> Create election</button>
              </div>

              {noticeOpen && (
                <div className="prototype-notice">
                  <div className="notice-icon"><Fingerprint size={18} /></div>
                  <p><strong>VoteChain Online Voting Prototype</strong><span> Cryptographic privacy-preserving voting engine with true ZK proofs, threshold decryption, and Ethereum auditability.</span></p>
                  <button className="icon-button notice-close" aria-label="Dismiss notice" title="Dismiss notice" onClick={() => setNoticeOpen(false)}><X size={16} /></button>
                </div>
              )}

              <section className="metrics-grid" aria-label="Election metrics">
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
                  <div className="metric-top"><span>LEDGER INTEGRITY</span><span className="metric-icon blue-icon"><ShieldCheck size={17} /></span></div>
                  <div className="integrity-value"><span className="integrity-check"><Check size={18} /></span><span>Verified</span></div>
                  <div className="integrity-caption">Blockchain commitments &amp; Merkle roots validated.</div>
                  <div className="metric-foot">
                    <span>Ethereum contract active</span>
                    <button onClick={() => router.push("/results")}>Inspect <ArrowUpRight size={14} /></button>
                  </div>
                </article>
              </section>

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
                      <button className="panel-link" onClick={() => router.push("/elections")}>Open election manager <ArrowUpRight size={15} /></button>
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
    </main>
  );
}