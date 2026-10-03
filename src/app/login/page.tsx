"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Fingerprint, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PasswordInput from "@/frontend/components/password-input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResendStatus(null);
    setUnverifiedEmail(null);
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json() as { error?: string; redirectTo?: string; emailUnverified?: boolean; email?: string };
      if (!response.ok) {
        setError(result.error ?? "Unable to sign in.");
        if (result.emailUnverified) {
          setUnverifiedEmail(result.email || email);
        }
        return;
      }
      router.replace(result.redirectTo ?? "/portal");
    } catch {
      setError("Could not reach VoteChain. Check the app and database connection.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResendVerification() {
    if (!unverifiedEmail) return;
    setResendBusy(true);
    setResendStatus(null);
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: unverifiedEmail }),
      });
      const data = await response.json() as { error?: string; message?: string };
      if (response.ok) {
        setResendStatus(data.message || "A new verification link has been sent to your email.");
      } else {
        setResendStatus(data.error || "Failed to resend verification link.");
      }
    } catch {
      setResendStatus("Could not reach server to resend verification link.");
    } finally {
      setResendBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-aside">
        <Link className="brand login-brand" href="/" aria-label="VoteChain home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </Link>
        <div className="login-aside-copy"><span className="login-overline">CAMPUS ELECTIONS / VERIFIABLE VOTING</span><h1>Trust begins<br />with a clear<br /><em>process.</em></h1><p>Cryptographically verified campus election platform for PSG College of Technology.</p></div>
        <div className="login-aside-foot"><Fingerprint size={18} /><span>Identity and ballot data are designed to remain separate.</span></div>
      </section>
      <section className="login-main">
        <div className="login-form-wrap">
          <span className="login-lock"><LockKeyhole size={18} /></span>
          <p className="login-overline">SECURE WORKSPACE</p>
          <h2>Sign in to VoteChain</h2>
          <p className="login-intro">Sign in with your verified PSG Tech account or administrative credentials.</p>
          <form className="login-form" onSubmit={handleSubmit}>
            <label htmlFor="email">Email address</label>
            <input id="email" autoComplete="username" type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
            <div className="password-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label htmlFor="password">Password</label>
              <Link href="/forgot-password" style={{ fontSize: "0.8rem", color: "#38bdf8", textDecoration: "none" }}>
                Forgot password?
              </Link>
            </div>
            <PasswordInput id="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} />
            {error && <p className="login-error" role="alert">{error}</p>}
            {unverifiedEmail && (
              <div style={{ marginTop: "0.5rem", marginBottom: "0.5rem" }}>
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={resendBusy}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#38bdf8",
                    textDecoration: "underline",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  {resendBusy ? "Resending..." : "Click here to resend verification link"}
                </button>
                {resendStatus && (
                  <p style={{ fontSize: "0.8rem", color: resendStatus.includes("sent") ? "#10b981" : "#ef4444", marginTop: "0.25rem" }}>
                    {resendStatus}
                  </p>
                )}
              </div>
            )}
            <button className="login-submit" type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}<ArrowRight size={16} /></button>
            <div style={{ textAlign: "center", marginTop: "1rem" }}>
              <span style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
                New student voter?{" "}
                <Link href="/register" style={{ color: "#10b981", fontWeight: 600, textDecoration: "underline" }}>
                  Register with @psgtech.ac.in
                </Link>
              </span>
            </div>
          </form>
          <div className="login-disclaimer"><span className="login-disclaimer-dot" /><p><strong>Campus election security</strong><br />Only verified institutional accounts can cast ballots. Ballots are submitted anonymously to the blockchain ledger.</p></div>
        </div>
        <footer className="login-footer"><span>VOTECHAIN · EDUCATIONAL USE</span><span>Session expires after 8 hours</span></footer>
      </section>
    </main>
  );
}