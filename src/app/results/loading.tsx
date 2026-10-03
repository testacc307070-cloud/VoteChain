export default function ResultsLoading() {
  return (
    <main className="portal-shell">
      <header className="portal-header">
        <div className="brand">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </div>
        <div style={{ color: "#85948a", fontSize: "11px" }}>Loading integrity ledger...</div>
      </header>
      <section className="portal-content">
        <p className="eyebrow">VERIFICATION / RESULT WINDOW</p>
        <h1>Public integrity dashboard</h1>
        <p className="page-subtitle">Verifying cryptographic digests and multi-authority threshold tallies...</p>
        <div
          style={{
            display: "grid",
            gap: "16px",
            marginTop: "2rem",
          }}
        >
          {[1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: "220px",
                background: "#ffffff",
                border: "1px solid var(--line, #e6e9e5)",
                borderRadius: "6px",
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
          ))}
        </div>
      </section>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </main>
  );
}
