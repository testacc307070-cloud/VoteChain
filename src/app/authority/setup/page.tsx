"use client";

import { useEffect, useState, useTransition, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Shield, Check, X, Lock, CheckCircle2, AlertTriangle, ArrowRight, Eye, EyeOff } from "lucide-react";

function AuthoritySetupInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [rawToken, setRawToken] = useState<string>("");
  const [verifying, setVerifying] = useState<boolean>(true);
  const [verifyError, setVerifyError] = useState<string>("");
  const [trustee, setTrustee] = useState<{ name: string; email: string } | null>(null);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Extract token, then immediately strip it from browser address bar
  useEffect(() => {
    const urlToken = searchParams.get("token")?.trim() || "";
    if (urlToken) {
      setRawToken(urlToken);

      // Strip sensitive raw token from browser address bar immediately
      if (typeof window !== "undefined" && window.history?.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      // Verify token with backend
      fetch(`/api/authority/verify-token?token=${encodeURIComponent(urlToken)}`)
        .then(async (res) => {
          const data = await res.json();
          if (res.ok && data.valid && data.user) {
            setTrustee(data.user);
          } else {
            setVerifyError(data.error || "This invitation link is invalid or has expired.");
          }
        })
        .catch(() => {
          setVerifyError("Network error checking invitation token.");
        })
        .finally(() => {
          setVerifying(false);
        });
    } else {
      setVerifyError("No invitation token was provided in the link.");
      setVerifying(false);
    }
  }, [searchParams]);

  // Real-time password policy validation checks
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
        const res = await fetch("/api/authority/activate", {
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
          setSubmitError(data.error || "Failed to activate authority account.");
        }
      } catch {
        setSubmitError("Network error while activating account.");
      }
    });
  };

  if (verifying) {
    return (
      <div className="login-box" style={{ maxWidth: 460, margin: "60px auto", padding: "32px", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <Shield style={{ width: 40, height: 40, color: "#6366f1", animation: "pulse 2s infinite" }} />
        </div>
        <h2 style={{ fontSize: "1.25rem", color: "#f8fafc", marginBottom: 8 }}>Verifying Invitation Link...</h2>
        <p style={{ fontSize: "0.875rem", color: "#94a3b8" }}>Securing connection and checking trustee authorization...</p>
      </div>
    );
  }

  if (verifyError) {
    return (
      <div className="login-box" style={{ maxWidth: 460, margin: "60px auto", padding: "32px", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <AlertTriangle style={{ width: 44, height: 44, color: "#ef4444" }} />
        </div>
        <h2 style={{ fontSize: "1.25rem", color: "#f8fafc", marginBottom: 8 }}>Invalid or Expired Invitation</h2>
        <p style={{ fontSize: "0.875rem", color: "#cbd5e1", lineHeight: 1.5, marginBottom: 24 }}>{verifyError}</p>
        <Link
          href="/login"
          style={{
            display: "inline-block",
            padding: "10px 20px",
            backgroundColor: "#1e293b",
            color: "#f8fafc",
            borderRadius: 8,
            textDecoration: "none",
            fontSize: "0.875rem",
          }}
        >
          Return to Sign In
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
        <h2 style={{ fontSize: "1.35rem", color: "#f8fafc", marginBottom: 8 }}>Trustee Account Activated!</h2>
        <p style={{ fontSize: "0.875rem", color: "#94a3b8", lineHeight: 1.6, marginBottom: 24 }}>
          Your account has been configured with threshold custody capabilities. You can now log in using your email and the password you just created.
        </p>
        <Link
          href="/login"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 24px",
            backgroundColor: "#6366f1",
            color: "#ffffff",
            borderRadius: 8,
            textDecoration: "none",
            fontSize: "0.95rem",
            fontWeight: 600,
          }}
        >
          Proceed to Sign In <ArrowRight style={{ width: 16, height: 16 }} />
        </Link>
      </div>
    );
  }

  return (
    <div className="login-box" style={{ maxWidth: 480, margin: "40px auto", padding: "32px" }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ display: "inline-flex", padding: 10, borderRadius: 12, backgroundColor: "rgba(99, 102, 241, 0.15)", marginBottom: 12 }}>
          <Shield style={{ width: 32, height: 32, color: "#818cf8" }} />
        </div>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#ffffff", margin: "0 0 6px" }}>
          Election Authority Trustee Activation
        </h1>
        <p style={{ fontSize: "0.85rem", color: "#94a3b8", margin: 0 }}>
          Create your private credentials for cryptographic election custody
        </p>
      </div>

      {trustee && (
        <div style={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "12px 16px", marginBottom: 20 }}>
          <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b", marginBottom: 2 }}>
            Trustee Identity
          </div>
          <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#f8fafc" }}>{trustee.name}</div>
          <div style={{ fontSize: "0.85rem", color: "#818cf8" }}>{trustee.email}</div>
        </div>
      )}

      {submitError && (
        <div style={{ backgroundColor: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 18, color: "#fca5a5", fontSize: "0.85rem" }}>
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "#cbd5e1", marginBottom: 6 }}>
            Set Secret Password
          </label>
          <div style={{ position: "relative" }}>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter strong password"
              style={{
                width: "100%",
                padding: "10px 42px 10px 12px",
                backgroundColor: "#090d16",
                border: "1px solid #1e293b",
                borderRadius: 8,
                color: "#ffffff",
                fontSize: "0.9rem",
              }}
              required
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((p) => !p)}
              style={{
                position: "absolute",
                right: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "#94a3b8",
                display: "grid",
                placeItems: "center",
                padding: 4,
              }}
              aria-label={showPassword ? "Hide password" : "Show password"}
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "#cbd5e1", marginBottom: 6 }}>
            Confirm Password
          </label>
          <div style={{ position: "relative" }}>
            <input
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              style={{
                width: "100%",
                padding: "10px 42px 10px 12px",
                backgroundColor: "#090d16",
                border: "1px solid #1e293b",
                borderRadius: 8,
                color: "#ffffff",
                fontSize: "0.9rem",
              }}
              required
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowConfirmPassword((p) => !p)}
              style={{
                position: "absolute",
                right: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "#94a3b8",
                display: "grid",
                placeItems: "center",
                padding: 4,
              }}
              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              title={showConfirmPassword ? "Hide password" : "Show password"}
            >
              {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
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
            backgroundColor: isFormValid ? "#6366f1" : "#334155",
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
          <Lock style={{ width: 16, height: 16 }} />
          {isPending ? "Activating Account..." : "Set Password & Activate Trustee"}
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

export default function AuthoritySetupPage() {
  return (
    <main className="portal-shell" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Suspense fallback={<div style={{ textAlign: "center", color: "#94a3b8", padding: 40 }}>Loading invitation...</div>}>
        <AuthoritySetupInner />
      </Suspense>
    </main>
  );
}
