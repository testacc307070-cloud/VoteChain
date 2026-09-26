"use client";

import { useState } from "react";
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

const activities = [
  { time: "10:42:18", title: "Election configuration locked", detail: "Student Council · 3 candidates", tag: "ADMIN", color: "green" },
  { time: "10:38:51", title: "Observer access granted", detail: "M. Chen · read-only role", tag: "ACCESS", color: "blue" },
  { time: "10:31:06", title: "Integrity check completed", detail: "Demo ledger · all records match", tag: "CHECK", color: "orange" },
];

type DashboardProps = { displayName: string; role: string };

export default function DashboardClient({ displayName, role }: DashboardProps) {
  const router = useRouter();
  const [activeNav, setActiveNav] = useState("Overview");
  const [noticeOpen, setNoticeOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const initials = displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <a className="brand" href="#overview" aria-label="VoteChain home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </a>
        <div className="workspace-switcher">
          <span className="workspace-icon">SC</span>
          <span className="workspace-copy"><strong>Student Council</strong><small>Demo workspace</small></span>
          <ChevronDown size={15} aria-hidden="true" />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav className="primary-nav" aria-label="Main navigation">
          {navigation.map(({ label, icon: Icon, href }) => {
            const className = `nav-item ${activeNav === label ? "nav-active" : ""}`;
            const content = <><Icon size={17} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span></>;
            return href
              ? <Link key={label} className={className} href={href} onClick={() => { setActiveNav(label); setMobileNavOpen(false); }}>{content}</Link>
              : <button key={label} className={className} onClick={() => { setActiveNav(label); setMobileNavOpen(false); }}>{content}</button>;
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
            <div className="topbar-date"><span className="live-dot" /> DEMO ENVIRONMENT</div>
          </div>
        </header>

        <div className="content-wrap">
          <div className="page-heading">
            <div>
              <p className="eyebrow">SATURDAY, SEPTEMBER 26, 2026 <span>•</span> ADMIN CONSOLE</p>
              <h1>Election overview</h1>
              <p className="page-subtitle">Phase 3 status: voting lifecycle, receipts, verification, and audit trail are active.</p>
            </div>
            <button className="primary-button" onClick={() => router.push("/elections")}><Plus size={17} /> Create election</button>
          </div>

          {noticeOpen && <div className="prototype-notice">
            <div className="notice-icon"><Fingerprint size={18} /></div>
            <p><strong>Research prototype</strong><span> Demo data only. This app does not accept or store real ballots.</span></p>
            <button className="icon-button notice-close" aria-label="Dismiss notice" title="Dismiss notice" onClick={() => setNoticeOpen(false)}><X size={16} /></button>
          </div>}

          <section className="metrics-grid" aria-label="Election metrics">
            <article className="metric-panel metric-primary">
              <div className="metric-top"><span>ACTIVE ELECTION</span><span className="status-pill"><i /> LIVE DEMO</span></div>
              <h2>Student Council<br />Election 2026</h2>
              <div className="metric-foot"><span>Closes today at 5:00 PM</span><button onClick={() => setActiveNav("Elections")}>View election <ArrowUpRight size={14} /></button></div>
              <div className="panel-grid" aria-hidden="true" />
            </article>
            <article className="metric-panel">
              <div className="metric-top"><span>PARTICIPATION</span><span className="metric-icon green-icon"><UsersRound size={17} /></span></div>
              <div className="metric-value">68<span className="metric-unit">%</span></div>
              <div className="metric-change"><span className="change-up"><ArrowUpRight size={14} /> 8.2%</span><span>vs. eligible voters</span></div>
              <div className="progress-track"><span style={{ width: "68%" }} /></div>
              <div className="metric-foot"><span>1,284 of 1,888 voters</span><span className="subtle-label">DEMO</span></div>
            </article>
            <article className="metric-panel">
              <div className="metric-top"><span>LEDGER INTEGRITY</span><span className="metric-icon blue-icon"><ShieldCheck size={17} /></span></div>
              <div className="integrity-value"><span className="integrity-check"><Check size={18} /></span><span>Verified</span></div>
              <div className="integrity-caption">All demo records match their<br />recorded hashes.</div>
              <div className="metric-foot"><span>Last checked 2 min ago</span><button onClick={() => setActiveNav("Ledger")}>Inspect <ArrowUpRight size={14} /></button></div>
            </article>
          </section>

          <section className="section-heading">
            <div><h2>Election activity</h2><p>Manage the current election and review recent events.</p></div>
            <button className="text-button" onClick={() => setActiveNav("Audit trail")}>View audit trail <ArrowUpRight size={15} /></button>
          </section>

          <div className="lower-grid">
            <section className="election-panel">
              <div className="panel-header"><div><span className="panel-kicker">CURRENT ELECTION</span><h3>Student Council Election 2026</h3></div><span className="status-pill status-open"><i /> ACTIVE</span></div>
              <div className="election-meta"><span><span className="meta-label">ELECTION ID</span><code>SC-2026-01</code></span><span><span className="meta-label">CANDIDATES</span><strong>03</strong></span><span><span className="meta-label">ELIGIBLE VOTERS</span><strong>1,888</strong></span></div>
              <div className="election-progress-label"><span>Participation</span><strong>68%</strong></div>
              <div className="progress-track election-progress"><span style={{ width: "68%" }} /></div>
              <div className="candidate-list">
                <div className="candidate-row"><span className="candidate-avatar candidate-one">JM</span><span className="candidate-name">Jordan Miller<small>Community first</small></span><span className="candidate-index">01</span></div>
                <div className="candidate-row"><span className="candidate-avatar candidate-two">RK</span><span className="candidate-name">Riley Kim<small>Better campus, together</small></span><span className="candidate-index">02</span></div>
                <div className="candidate-row"><span className="candidate-avatar candidate-three">AS</span><span className="candidate-name">Avery Singh<small>Listen. Build. Deliver.</small></span><span className="candidate-index">03</span></div>
              </div>
              <button className="panel-link" onClick={() => setActiveNav("Elections")}>Open election details <ArrowUpRight size={15} /></button>
            </section>

            <section className="activity-panel">
              <div className="activity-heading"><div><span className="panel-kicker">SYSTEM LOG</span><h3>Recent activity</h3></div><button className="icon-button" aria-label="Activity options" title="Activity options"><ChevronDown size={16} /></button></div>
              <div className="activity-list">
                {activities.map((activity) => <article className="activity-row" key={activity.time}>
                  <span className={`activity-marker marker-${activity.color}`} />
                  <div className="activity-copy"><span className="activity-time">{activity.time} <i>{activity.tag}</i></span><strong>{activity.title}</strong><span className="activity-detail">{activity.detail}</span></div>
                </article>)}
              </div>
              <button className="panel-link" onClick={() => setActiveNav("Audit trail")}>View all activity <ArrowUpRight size={15} /></button>
              <div className="ledger-note"><LockKeyhole size={15} /><span>Audit events are append-oriented in the planned system.</span></div>
            </section>
          </div>

          <footer className="page-footer"><span>VOTECHAIN <i>·</i> PHASE 3 / VOTING & VERIFICATION</span><span>Built for research and demonstration <ArrowDownRight size={13} /></span></footer>
        </div>
      </section>
    </main>
  );
}