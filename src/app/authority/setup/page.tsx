"use client";

import { useEffect, useState, useRef, useTransition, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Shield, Check, X, Lock, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";
import { PasswordInput } from "@/frontend/components/password-input";

function AuthoritySetupInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const tokenProcessedRef = useRef(false);
  const [rawToken, setRawToken] = useState<string>("");
  const [verifying, setVerifying] = useState<boolean>(true);
  const [verifyError, setVerifyError] = useState<string>("");
  const [trustee, setTrustee] = useState<{ name: string; email: string } | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Validate token from URL parameter, then remove from address bar AFTER verification
  useEffect(() => {
    if (tokenProcessedRef.current) return;

    const urlToken = searchParams.get("token")?.trim() || "";
    if (!urlToken) {
      setVerifyError("No invitation token was provided in the link.");
      setVerifying(false);
      return;
    }

    tokenProcessedRef.current = true;
    setRawToken(urlToken);

    // Verify token with backend BEFORE scrubbing URL to prevent premature state wiping
    fetch(`/api/authority/verify-token?token=${encodeURIComponent(urlToken)}`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok && data.valid && data.user) {
          setTrustee(data.user);
          setName(data.user.name || "");
          setEmail(data.user.email || "");

          // AFTER successful validation, immediately remove token from address bar for security
          if (typeof window !== "undefined" && window.history?.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
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
    name.trim().length >= 2 &&
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
            name: name.trim(),
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
      <div
        className="login-box"
        style={{
          maxWidth: 480,
          margin: "60px auto",
          padding: "32px",
          textAlign: "center",
          backgroundColor: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          boxShadow: "0 4px 20px -2px rgba(15, 23, 42, 0.08)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <Shield style={{ width: 40, height: 40, color: "#4f46e5", animation: "pulse 2s infinite" }} />
        </div>
        <h2 style={{ fontSize: "1.25rem", color: "#0f172a", fontWeight: 700, marginBottom: 8 }}>Verifying Invitation Link...</h2>
        <p style={{ fontSize: "0.875rem", color: "#475569" }}>Securing connection and checking trustee authorization...</p>
      </div>
    );
  }

  if (verifyError) {
    const isMissingToken = verifyError === "No invitation token was provided in the link.";
    return (
      <div
        className="login-box"
        style={{
          maxWidth: 480,
          margin: "60px auto",
          padding: "32px",
          textAlign: "center",
          backgroundColor: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          boxShadow: "0 4px 20px -2px rgba(15, 23, 42, 0.08)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          {isMissingToken ? (
            <Shield style={{ width: 44, height: 44, color: "#4f46e5" }} />
          ) : (
            <AlertTriangle style={{ width: 44, height: 44, color: "#dc2626" }} />
          )}
        </div>
        <h2 style={{ fontSize: "1.25rem", color: "#0f172a", fontWeight: 700, marginBottom: 8 }}>
          {isMissingToken ? "Authority Trustee Registration" : "Invalid or Expired Invitation"}
        </h2>
        <p style={{ fontSize: "0.875rem", color: "#475569", lineHeight: 1.6, marginBottom: 24 }}>
          {isMissingToken
            ? "Authority Trustee accounts are created by administrator invitation to maintain 2-of-3 threshold cryptographic custody. If you received an invitation email, please click the setup link in your email. If you have already activated your account, you can sign in below."
            : verifyError}
        </p>
        <Link
          href="/login"
          style={{
            display: "inline-block",
            padding: "10px 20px",
            backgroundColor: "#4f46e5",
            color: "#ffffff",
            borderRadius: 8,
            textDecoration: "none",
            fontSize: "0.875rem",
            fontWeight: 600,
          }}
        >
          Sign In to VoteChain
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div
        className="login-box"
        style={{
          maxWidth: 480,
          margin: "60px auto",
          padding: "32px",
          textAlign: "center",
          backgroundColor: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          boxShadow: "0 4px 20px -2px rgba(15, 23, 42, 0.08)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <CheckCircle2 style={{ width: 48, height: 48, color: "#16a34a" }} />
        </div>
        <h2 style={{ fontSize: "1.35rem", color: "#0f172a", fontWeight: 700, marginBottom: 8 }}>Trustee Account Activated!</h2>
        <p style={{ fontSize: "0.875rem", color: "#475569", lineHeight: 1.6, marginBottom: 24 }}>
          Your account has been configured with 2-of-3 threshold cryptographic custody capabilities. You can now log in using your email and the password you just created.
        </p>
        <Link
          href="/login"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 24px",
            backgroundColor: "#4f46e5",
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
    <div
      className="login-box"
      style={{
        maxWidth: 500,
        margin: "40px auto",
        padding: "32px",
        backgroundColor: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        boxShadow: "0 4px 20px -2px rgba(15, 23, 42, 0.08)",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ display: "inline-flex", padding: 10, borderRadius: 12, backgroundColor: "#eef2ff", marginBottom: 12 }}>
          <Shield style={{ width: 32, height: 32, color: "#4f46e5" }} />
        </div>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#0f172a", margin: "0 0 6px" }}>
          Authority Trustee Registration & Setup
        </h1>
        <p style={{ fontSize: "0.85rem", color: "#475569", margin: 0 }}>
          Set up your credentials for 2-of-3 threshold cryptographic election custody
        </p>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          padding: "10px 14px",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Shield size={16} style={{ color: "#4f46e5" }} />
          <span style={{ fontSize: "0.82rem", color: "#1e293b", fontWeight: 600 }}>Role: Authority Trustee</span>
        </div>
        <span
          style={{
            fontSize: "0.72rem",
            backgroundColor: "#fef3c7",
            border: "1px solid #fde68a",
            color: "#92400e",
            padding: "2px 8px",
            borderRadius: 4,
            fontWeight: 600,
            letterSpacing: "0.04em",
          }}
        >
          STATUS: INVITED
        </span>
      </div>

      {submitError && (
        <div
          style={{
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 18,
            color: "#991b1b",
            fontSize: "0.85rem",
          }}
        >
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Full Name */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#1e293b", marginBottom: 6 }}>
            Full Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={80}
            placeholder="Your full name"
            style={{
              width: "100%",
              padding: "10px 12px",
              backgroundColor: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              color: "#0f172a",
              fontSize: "0.9rem",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Email Address (Bound to Invitation) */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#1e293b" }}>
              Authority Email
            </label>
            <span
              style={{
                fontSize: "0.72rem",
                color: "#15803d",
                backgroundColor: "#f0fdf4",
                border: "1px solid #bbf7d0",
                padding: "2px 6px",
                borderRadius: 4,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <CheckCircle2 size={12} /> Bound to Invitation
            </span>
          </div>
          <input
            type="email"
            value={email}
            readOnly
            disabled
            style={{
              width: "100%",
              padding: "10px 12px",
              backgroundColor: "#f1f5f9",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              color: "#334155",
              fontSize: "0.9rem",
              cursor: "not-allowed",
              boxSizing: "border-box",
            }}
          />
          <span style={{ display: "block", fontSize: "0.74rem", color: "#475569", marginTop: 4 }}>
            Account is bound to this invited address. External domains (e.g. Gmail) are fully supported.
          </span>
        </div>

        {/* Password */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#1e293b", marginBottom: 6 }}>
            Password
          </label>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter strong password"
            required
            autoComplete="new-password"
            className="w-full"
            inputStyle={{
              backgroundColor: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              color: "#0f172a",
              fontSize: "0.9rem",
              padding: "10px 12px",
            }}
          />
        </div>

        {/* Confirm Password */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#1e293b", marginBottom: 6 }}>
            Confirm Password
          </label>
          <PasswordInput
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
            required
            autoComplete="new-password"
            className="w-full"
            inputStyle={{
              backgroundColor: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              color: "#0f172a",
              fontSize: "0.9rem",
              padding: "10px 12px",
            }}
          />
        </div>

        {/* Policy Checklist */}
        <div
          style={{
            backgroundColor: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: "14px 16px",
            marginBottom: 24,
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "#334155",
              marginBottom: 8,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
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
            backgroundColor: isFormValid ? "#4f46e5" : "#e2e8f0",
            color: isFormValid ? "#ffffff" : "#94a3b8",
            border: isFormValid ? "1px solid #4338ca" : "1px solid #cbd5e1",
            borderRadius: 8,
            fontWeight: 600,
            fontSize: "0.95rem",
            cursor: isFormValid ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            boxShadow: isFormValid ? "0 2px 8px rgba(79, 70, 229, 0.25)" : "none",
            transition: "all 0.15s ease",
          }}
        >
          <Lock style={{ width: 16, height: 16 }} />
          {isPending ? "Activating Trustee Account..." : "Complete Authority Registration"}
        </button>
      </form>
    </div>
  );
}

function PolicyItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        color: ok ? "#166534" : "#64748b",
        fontWeight: ok ? 500 : 400,
      }}
    >
      {ok ? (
        <Check style={{ width: 14, height: 14, color: "#16a34a", flexShrink: 0 }} />
      ) : (
        <X style={{ width: 14, height: 14, color: "#94a3b8", flexShrink: 0 }} />
      )}
      <span>{label}</span>
    </div>
  );
}

export default function AuthoritySetupPage() {
  return (
    <main className="portal-shell" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Suspense fallback={<div style={{ textAlign: "center", color: "#475569", padding: 40, fontWeight: 500 }}>Loading invitation...</div>}>
        <AuthoritySetupInner />
      </Suspense>
    </main>
  );
}
