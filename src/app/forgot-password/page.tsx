"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { KeyRound, Mail, ArrowLeft, CheckCircle2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    setError("");
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim().toLowerCase() }),
        });

        const data = await res.json();
        if (res.ok && data.ok) {
          setSubmitted(true);
        } else {
          setError(data.error || "Failed to process password reset request.");
        }
      } catch {
        setError("Network error while submitting password reset request.");
      }
    });
  };

  return (
    <main className="portal-shell" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div className="login-box" style={{ maxWidth: 440, margin: "40px auto", padding: "32px" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ display: "inline-flex", padding: 10, borderRadius: 12, backgroundColor: "rgba(59, 130, 246, 0.15)", marginBottom: 12 }}>
            <KeyRound style={{ width: 32, height: 32, color: "#60a5fa" }} />
          </div>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#ffffff", margin: "0 0 6px" }}>
            Reset Your Password
          </h1>
          <p style={{ fontSize: "0.85rem", color: "#94a3b8", margin: 0 }}>
            Enter your registered email address to receive a secure recovery link
          </p>
        </div>

        {error && (
          <div style={{ backgroundColor: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 18, color: "#fca5a5", fontSize: "0.85rem" }}>
            {error}
          </div>
        )}

        {submitted ? (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
              <CheckCircle2 style={{ width: 44, height: 44, color: "#10b981" }} />
            </div>
            <h2 style={{ fontSize: "1.1rem", color: "#f8fafc", marginBottom: 8 }}>Check Your Inbox</h2>
            <p style={{ fontSize: "0.85rem", color: "#94a3b8", lineHeight: 1.6, marginBottom: 24 }}>
              If an account is registered with <strong>{email}</strong>, a password reset link has been dispatched. The link expires in <strong>1 hour</strong>.
            </p>
            <Link
              href="/login"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                backgroundColor: "#1e293b",
                color: "#f8fafc",
                borderRadius: 8,
                textDecoration: "none",
                fontSize: "0.875rem",
              }}
            >
              <ArrowLeft style={{ width: 14, height: 14 }} /> Back to Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "#cbd5e1", marginBottom: 6 }}>
                Registered Email Address
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="student@psgtech.ac.in or trustee email"
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
            </div>

            <button
              type="submit"
              disabled={isPending}
              style={{
                width: "100%",
                padding: "12px",
                backgroundColor: "#3b82f6",
                color: "#ffffff",
                border: "none",
                borderRadius: 8,
                fontWeight: 600,
                fontSize: "0.95rem",
                cursor: isPending ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                marginBottom: 16,
              }}
            >
              <Mail style={{ width: 16, height: 16 }} />
              {isPending ? "Sending Reset Link..." : "Send Reset Link"}
            </button>

            <div style={{ textAlign: "center" }}>
              <Link
                href="/login"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  color: "#94a3b8",
                  fontSize: "0.85rem",
                  textDecoration: "none",
                }}
              >
                <ArrowLeft style={{ width: 14, height: 14 }} /> Back to Sign In
              </Link>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
