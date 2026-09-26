"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Fingerprint, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json() as { error?: string; redirectTo?: string };
      if (!response.ok) {
        setError(result.error ?? "Unable to sign in.");
        return;
      }
      router.replace(result.redirectTo ?? "/portal");
    } catch {
      setError("Could not reach VoteChain. Check the app and database connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-aside">
        <Link className="brand login-brand" href="/" aria-label="VoteChain home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </Link>
        <div className="login-aside-copy"><span className="login-overline">RESEARCH PROTOTYPE / PHASE 1</span><h1>Trust begins<br />with a clear<br /><em>process.</em></h1><p>Role-based access for an educational election integrity prototype.</p></div>
        <div className="login-aside-foot"><Fingerprint size={18} /><span>Identity and ballot data are designed to remain separate.</span></div>
      </section>
      <section className="login-main">
        <div className="login-form-wrap">
          <span className="login-lock"><LockKeyhole size={18} /></span>
          <p className="login-overline">SECURE WORKSPACE</p>
          <h2>Sign in to VoteChain</h2>
          <p className="login-intro">Use your administrator-provisioned account to continue.</p>
          <form className="login-form" onSubmit={handleSubmit}>
            <label htmlFor="email">Email address</label>
            <input id="email" autoComplete="username" type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
            <div className="password-label"><label htmlFor="password">Password</label></div>
            <input id="password" autoComplete="current-password" type="password" required maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} />
            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="login-submit" type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}<ArrowRight size={16} /></button>
          </form>
          <div className="login-disclaimer"><span className="login-disclaimer-dot" /><p><strong>Prototype environment</strong><br />Only authorized test accounts can access this workspace. No real ballots are handled.</p></div>
        </div>
        <footer className="login-footer"><span>VOTECHAIN · EDUCATIONAL USE</span><span>Session expires after 8 hours</span></footer>
      </section>
    </main>
  );
}