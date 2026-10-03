"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Fingerprint, Mail, RefreshCw, UserPlus } from "lucide-react";
import Link from "next/link";
import PasswordInput from "@/frontend/components/password-input";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResendMessage(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!email.trim().toLowerCase().endsWith("@psgtech.ac.in")) {
      setError("Registration requires an institutional email ending with @psgtech.ac.in.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          studentId: studentId.trim().toUpperCase(),
          email: email.trim().toLowerCase(),
          password,
        }),
      });

      const data = (await response.json()) as { error?: string; message?: string; email?: string };

      if (!response.ok) {
        setError(data.error || "Unable to complete registration.");
        return;
      }

      setRegisteredEmail(data.email || email.trim().toLowerCase());
    } catch {
      setError("Could not reach VoteChain service. Check network or server connection.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (!registeredEmail) return;
    setResendBusy(true);
    setResendMessage(null);
    setError("");

    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: registeredEmail }),
      });

      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        setError(data.error || "Failed to resend verification email.");
      } else {
        setResendMessage(data.message || "A new verification link has been sent to your PSG Tech inbox.");
      }
    } catch {
      setError("Unable to contact verification service.");
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
        <div className="login-aside-copy">
          <span className="login-overline">STUDENT REGISTRATION</span>
          <h1>Campus elections<br />verified with<br /><em>integrity.</em></h1>
          <p>Register with your official PSG Tech student credentials to participate in transparent, cryptographically verified campus ballots.</p>
        </div>
        <div className="login-aside-foot">
          <Fingerprint size={18} />
          <span>Institutional verification proves identity; ballots remain cryptographically isolated and anonymous.</span>
        </div>
      </section>

      <section className="login-main">
        <div className="login-form-wrap">
          <span className="login-lock"><UserPlus size={18} /></span>
          <p className="login-overline">PSG TECH VOTER ACCESS</p>
          <h2>Create Student Account</h2>
          <p className="login-intro">
            Institutional verification is restricted to official <code>@psgtech.ac.in</code> accounts.
          </p>

          {registeredEmail ? (
            <div style={{ marginTop: "1rem" }}>
              <div style={{
                background: "rgba(16, 185, 129, 0.1)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                borderRadius: "8px",
                padding: "1.25rem",
                marginBottom: "1.5rem"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#10b981", fontWeight: 700, marginBottom: "0.5rem" }}>
                  <CheckCircle2 size={20} />
                  <span>Check Your PSG Tech Email</span>
                </div>
                <p style={{ fontSize: "0.875rem", color: "#cbd5e1", lineHeight: 1.5, margin: 0 }}>
                  We sent a verification link to <strong>{registeredEmail}</strong> from <code>votechain.verify@gmail.com</code>.
                  Click the link in the email to activate your voting eligibility.
                </p>
              </div>

              {resendMessage && (
                <p style={{ color: "#10b981", fontSize: "0.85rem", marginBottom: "1rem" }}>
                  {resendMessage}
                </p>
              )}

              {error && <p className="login-error" role="alert">{error}</p>}

              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendBusy}
                  className="secondary-button"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.5rem",
                    padding: "0.75rem",
                    fontSize: "0.875rem",
                    cursor: resendBusy ? "not-allowed" : "pointer",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "6px",
                    color: "#f1f5f9"
                  }}
                >
                  <RefreshCw size={14} className={resendBusy ? "spin" : ""} />
                  {resendBusy ? "Resending..." : "Resend Verification Email"}
                </button>

                <Link
                  href="/login"
                  className="login-submit"
                  style={{ textDecoration: "none", textAlign: "center" }}
                >
                  Proceed to Sign In <ArrowRight size={16} />
                </Link>
              </div>
            </div>
          ) : (
            <form className="login-form" onSubmit={handleRegister}>
              <label htmlFor="name">Full Name</label>
              <input
                id="name"
                type="text"
                required
                maxLength={100}
                placeholder="e.g. Eleanor Vance"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <label htmlFor="studentId">Student ID (Roll Number)</label>
              <input
                id="studentId"
                type="text"
                required
                maxLength={30}
                placeholder="e.g. 24N236"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
              />

              <label htmlFor="email">
                PSG Tech Email Address <small style={{ color: "#10b981" }}>(@psgtech.ac.in only)</small>
              </label>
              <input
                id="email"
                type="email"
                required
                maxLength={254}
                placeholder="e.g. 24n236@psgtech.ac.in"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <div className="password-label">
                <label htmlFor="password">Password (min 8 characters)</label>
              </div>
              <PasswordInput
                id="password"
                required
                minLength={8}
                maxLength={1024}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <div className="password-label">
                <label htmlFor="confirmPassword">Confirm Password</label>
              </div>
              <PasswordInput
                id="confirmPassword"
                required
                minLength={8}
                maxLength={1024}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />

              {error && <p className="login-error" role="alert">{error}</p>}

              <button className="login-submit" type="submit" disabled={busy}>
                {busy ? "Registering..." : "Register Account"}
                <ArrowRight size={16} />
              </button>

              <div style={{ textAlign: "center", marginTop: "1rem" }}>
                <span style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
                  Already registered?{" "}
                  <Link href="/login" style={{ color: "#38bdf8", textDecoration: "underline" }}>
                    Sign in here
                  </Link>
                </span>
              </div>
            </form>
          )}

          <div className="login-disclaimer">
            <span className="login-disclaimer-dot" />
            <p>
              <strong>PSG Tech Campus Network</strong><br />
              Email verification prevents automated sybil registrations. One verified account per student ID.
            </p>
          </div>
        </div>
        <footer className="login-footer">
          <span>VOTECHAIN &middot; EDUCATIONAL USE</span>
          <span>PSG College of Technology</span>
        </footer>
      </section>
    </main>
  );
}
