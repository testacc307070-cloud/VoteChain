"use client";

import { useEffect, useState, useTransition, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, KeyRound, Check, X, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [rawToken, setRawToken] = useState("");
  const [verifying, setVerifying] = useState(true);
  const [verifyError, setVerifyError] = useState("");
  const [accountEmail, setAccountEmail] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const urlToken = searchParams.get("token")?.trim() || "";
    if (urlToken) {
      setRawToken(urlToken);

      // Immediately sanitize browser address bar to prevent token leakage
      if (typeof window !== "undefined" && window.history?.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      fetch(`/api/auth/verify-reset-token?token=${encodeURIComponent(urlToken)}`)
        .then(async (res) => {
          const data = await res.json();
          if (res.ok && data.valid) {
            setAccountEmail(data.email || "");
          } else {
            setVerifyError(data.error || "This password reset link is invalid or has expired.");
          }
        })
        .catch(() => {
          setVerifyError("Network error checking password reset link.");
        })
        .finally(() => {
          setVerifying(false);
        });
    } else {
      setVerifyError("No reset token was provided in the link.");
      setVerifying(false);
    }
  }, [searchParams]);

  const checks = {
    length: password.length >= 10,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    digit: /[0-9]/.test(password),
    symbol: /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password),
    match: password.length > 0 && password === confirmPassword,
  };

  const isFormValid =
    checks.length &&
    checks.upper &&
    checks.lower &&
    checks.digit &&
    checks.symbol &&
    checks.match;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || !rawToken) return;

    setSubmitError("");
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: rawToken,
            password,
          }),
        });

        const data = await res.json();
        if (res.ok && data.ok) {
          setSuccess(true);
        } else {
          setSubmitError(data.error || "Failed to reset password.");
        }
      } catch {
        setSubmitError("Network error while resetting password.");
      }
    });
  };

  if (verifying) {
    return (
      <div className="login-box" style={{ maxWidth: 460, margin: "60px auto", padding: "32px", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <KeyRound style={{ width: 40, height: 40, color: "#3b82f6", animation: "pulse 2s infinite" }} />
        </div>
        <h2 style={{ fontSize: "1.25rem", color: "#f8fafc", marginBottom: 8 }}>Verifying Reset Link...</h2>
        <p style={{ fontSize: "0.875rem", color: "#94a3b8" }}>Validating security token...</p>
      </div>
    );
  }

  if (verifyError) {
    return (
      <div className="login-box" style={{ maxWidth: 460, margin: "60px auto", padding: "32px", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <AlertTriangle style={{ width: 44, height: 44, color: "#ef4444" }} />
        </div>
        <h2 style={{ fontSize: "1.25rem", color: "#f8fafc", marginBottom: 8 }}>Invalid Reset Link</h2>
        <p style={{ fontSize: "0.875rem", color: "#cbd5e1", lineHeight: 1.5, marginBottom: 24 }}>{verifyError}</p>
        <Link
          href="/forgot-password"
          style={{
            display: "inline-block",
            padding: "10px 20px",
            backgroundColor: "#3b82f6",
            color: "#ffffff",
            borderRadius: 8,
            textDecoration: "none",
            fontSize: "0.875rem",
          }}
        >
          Request New Reset Link
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="login-box" style={{ maxWidth: 460, margin: "60px auto", padding: "32px", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <CheckCircle2 style={{ width: 48, height: 48, color: "#10b981" }} />
        </div>
        <h2 style={{ fontSize: "1.35rem", color: "#f8fafc", marginBottom: 8 }}>Password Updated!</h2>
        <p style={{ fontSize: "0.875rem", color: "#94a3b8", lineHeight: 1.6, marginBottom: 24 }}>
          Your account password has been updated securely. You can now sign in with your new credentials.
        </p>
        <Link
          href="/login"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 24px",
            backgroundColor: "#3b82f6",
            color: "#ffffff",
            borderRadius: 8,
            textDecoration: "none",
            fontSize: "0.95rem",
            fontWeight: 600,
          }}
        >
          Sign In Now <ArrowRight style={{ width: 16, height: 16 }} />
        </Link>
      </div>
    );
  }

  return (
    <div className="login-box" style={{ maxWidth: 480, margin: "40px auto", padding: "32px" }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ display: "inline-flex", padding: 10, borderRadius: 12, backgroundColor: "rgba(59, 130, 246, 0.15)", marginBottom: 12 }}>
          <Lock style={{ width: 32, height: 32, color: "#60a5fa" }} />
        </div>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#ffffff", margin: "0 0 6px" }}>
          Create New Password
        </h1>
        <p style={{ fontSize: "0.85rem", color: "#94a3b8", margin: 0 }}>
          {accountEmail ? `Resetting password for ${accountEmail}` : "Enter your new password below"}
        </p>
      </div>

      {submitError && (
        <div style={{ backgroundColor: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 18, color: "#fca5a5", fontSize: "0.85rem" }}>
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "#cbd5e1", marginBottom: 6 }}>
            New Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter new strong password"
            style={{
              width: "100%",
              padding: "10px 12px",
              backgroundColor: "#090d16",
              border: "1px solid #1e293b",
              borderRadius: 8,
              color: "#ffffff",
              fontSize: "0.9rem",
            }}
            required
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "#cbd5e1", marginBottom: 6 }}>
            Confirm New Password
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter new password"
            style={{
              width: "100%",
              padding: "10px 12px",
              backgroundColor: "#090d16",
              border: "1px solid #1e293b",
              borderRadius: 8,
              color: "#ffffff",
              fontSize: "0.9rem",
            }}
            required
          />
        </div>

        {/* Policy Checklist */}
        <div style={{ backgroundColor: "#090d16", border: "1px solid #1e293b", borderRadius: 8, padding: "12px", marginBottom: 24 }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b", marginBottom: 8, textTransform: "uppercase" }}>
            Password Security Requirements
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", fontSize: "0.78rem" }}>
            <PolicyItem label="At least 10 chars" ok={checks.length} />
            <PolicyItem label="Uppercase letter (A-Z)" ok={checks.upper} />
            <PolicyItem label="Lowercase letter (a-z)" ok={checks.lower} />
            <PolicyItem label="Numeric digit (0-9)" ok={checks.digit} />
            <PolicyItem label="Symbol (!@#$%...)" ok={checks.symbol} />
            <PolicyItem label="Passwords match" ok={checks.match} />
          </div>
        </div>

        <button
          type="submit"
          disabled={!isFormValid || isPending}
          style={{
            width: "100%",
            padding: "12px",
            backgroundColor: isFormValid ? "#3b82f6" : "#334155",
            color: isFormValid ? "#ffffff" : "#94a3b8",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            fontSize: "0.95rem",
            cursor: isFormValid ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <KeyRound style={{ width: 16, height: 16 }} />
          {isPending ? "Updating Password..." : "Update Password"}
        </button>
      </form>
    </div>
  );
}

function PolicyItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, color: ok ? "#10b981" : "#64748b" }}>
      {ok ? <Check style={{ width: 13, height: 13, color: "#10b981" }} /> : <X style={{ width: 13, height: 13, color: "#64748b" }} />}
      <span>{label}</span>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="portal-shell" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Suspense fallback={<div style={{ textAlign: "center", color: "#94a3b8", padding: 40 }}>Loading reset page...</div>}>
        <ResetPasswordInner />
      </Suspense>
    </main>
  );
}
