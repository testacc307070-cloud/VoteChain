export default function Loading() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--canvas, #f6f7f4)",
        color: "#64736b",
        fontFamily: "var(--font-ui), sans-serif",
        gap: "12px",
      }}
    >
      <div
        style={{
          width: "36px",
          height: "36px",
          border: "3px solid #dfe5df",
          borderTopColor: "#327c5c",
          borderRadius: "50%",
          animation: "spin 0.7s linear infinite",
        }}
      />
      <span style={{ fontSize: "12px", fontWeight: 500, letterSpacing: "0.02em" }}>
        Loading VoteChain workspace...
      </span>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
