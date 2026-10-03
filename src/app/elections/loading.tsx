export default function ElectionsLoading() {
  return (
    <main className="elections-shell">
      <header className="elections-topbar">
        <div className="brand">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>votechain<span className="brand-period">.</span></span>
        </div>
        <div style={{ color: "#85948a", fontSize: "11px" }}>Loading elections...</div>
      </header>
      <section className="elections-content">
        <div className="page-heading elections-heading">
          <div>
            <p className="eyebrow">ADMINISTRATION / ELECTION CONTROLS</p>
            <h1>Elections Manager</h1>
            <p className="page-subtitle">Retrieving active elections and eligibility records...</p>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gap: "12px",
            marginTop: "1.5rem",
          }}
        >
          {[1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: "160px",
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
