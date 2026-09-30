"use client";

import { Suspense, useState, useEffect, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, XCircle, RefreshCw, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [status, setStatus] = useState<"pending" | "verifying" | "success" | "error">(token ? "verifying" : "pending");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [resendEmail, setResendEmail] = useState("");
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);

  useEffect(() => {
    if (!token) return;

    let isMounted = true;
    async function verify() {
      try {
        const response = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const data = (await response.json()) as { error?: string; message?: string };
        if (!isMounted) return;

        if (response.ok) {
          setStatus("success");
          setSuccessMessage(data.message || "Your PSG Tech email has been verified successfully!");
        } else {
          setStatus("error");
          setErrorMessage(data.error || "Email verification failed. The link may have expired or already been used.");
        }
      } catch {
        if (isMounted) {
          setStatus("error");
          setErrorMessage("Could not reach verification server. Please check your connection and try again.");
        }
      }
    }

    verify();
    return () => {
      isMounted = false;
    };
  }, [token]);

  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResendStatus(null);
    setResendBusy(true);

    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resendEmail.trim().toLowerCase() }),
      });

      const data = (await response.json()) as { error?: string; message?: string };
      if (response.ok) {
        setResendStatus(data.message || "A new verification link has been sent to your email.");
      } else {
        setResendStatus(data.error || "Failed to resend verification email.");
      }
    } catch {
      setResendStatus("Unable to connect to verification service.");
    } finally {
      setResendBusy(false);
    }
  }

  return (
    <div className="login-form-wrap">
      <span className="login-lock"><ShieldCheck size={18} /></span>
      <p className="login-overline">ACCOUNT VERIFICATION</p>
      <h2>Email Confirmation</h2>

      {status === "verifying" && (
        <div style={{ textAlign: "center", padding: "2rem 0" }}>
          <RefreshCw size={36} className="spin" style={{ color: "#38bdf8", margin: "0 auto 1rem" }} />
          <p style={{ color: "#cbd5e1", fontSize: "0.95rem" }}>Verifying your PSG Tech institutional credentials...</p>
        </div>
      )}

      {status === "success" && (
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
              <span>Email Verified Successfully</span>
            </div>
            <p style={{ fontSize: "0.875rem", color: "#cbd5e1", lineHeight: 1.5, margin: 0 }}>
              {successMessage}
            </p>
          </div>

          <Link
            href="/login"
            className="login-submit"
            style={{ textDecoration: "none", textAlign: "center", display: "flex", justifyContent: "center" }}
          >
            Sign in to VoteChain <ArrowRight size={16} />
          </Link>
        </div>
      )}

      {(status === "error" || (status === "pending" && !token)) && (
        <div style={{ marginTop: "1rem" }}>
          {status === "error" && (
            <div style={{
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              borderRadius: "8px",
              padding: "1.25rem",
              marginBottom: "1.5rem"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#ef4444", fontWeight: 700, marginBottom: "0.5rem" }}>
                <XCircle size={20} />
                <span>Verification Link Invalid</span>
              </div>
              <p style={{ fontSize: "0.875rem", color: "#cbd5e1", lineHeight: 1.5, margin: 0 }}>
                {errorMessage}
              </p>
            </div>
          )}

          <p style={{ fontSize: "0.875rem", color: "#94a3b8", marginBottom: "1rem" }}>
            Need a new verification link? Enter your registered PSG Tech email below:
          </p>

          <form onSubmit={handleResend} className="login-form">
            <label htmlFor="resendEmail">PSG Tech Email Address</label>
            <input
              id="resendEmail"
              type="email"
              required
              placeholder="e.g. 24n236@psgtech.ac.in"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
            />

            {resendStatus && (
              <p style={{
                color: resendStatus.includes("sent") ? "#10b981" : "#ef4444",
                fontSize: "0.85rem",
                marginTop: "0.25rem"
              }}>
                {resendStatus}
              </p>
            )}

            <button className="login-submit" type="submit" disabled={resendBusy}>
              {resendBusy ? "Sending link..." : "Send New Verification Link"}
              <Mail size={16} />
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: "1.25rem" }}>
            <Link href="/login" style={{ fontSize: "0.85rem", color: "#38bdf8", textDecoration: "underline" }}>
              Return to Sign In
            </Link>
          </div>
        </div>
      )}

      <div className="login-disclaimer">
        <span className="login-disclaimer-dot" />
        <p>
          <strong>Institutional Email Security</strong><br />
          Verification links expire 24 hours after creation. Tokens are single-use and invalidated immediately upon confirmation.
        </p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="login-shell">
      <section className="login-aside">
        <Link className="brand login-brand" href="/" aria-label="VoteChain home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </Link>
        <div className="login-aside-copy">
          <span className="login-overline">CRYPTOGRAPHIC ACCESS</span>
          <h1>Identity verified,<br />ballots isolated<br /><em>by design.</em></h1>
          <p>Email verification guarantees that every participant belongs to the institutional community without linking identity to cast ballots.</p>
        </div>
        <div className="login-aside-foot">
          <ShieldCheck size={18} />
          <span>Double-blind architecture separates voter verification from the cryptographic ballot ledger.</span>
        </div>
      </section>

      <section className="login-main">
        <Suspense fallback={<div className="login-form-wrap"><p>Loading verification status...</p></div>}>
          <VerifyEmailContent />
        </Suspense>
        <footer className="login-footer">
          <span>VOTECHAIN &middot; EDUCATIONAL USE</span>
          <span>PSG College of Technology</span>
        </footer>
      </section>
    </main>
  );
}
