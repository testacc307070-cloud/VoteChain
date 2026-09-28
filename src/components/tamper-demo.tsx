"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert, ShieldCheck, RefreshCw } from "lucide-react";

type Block = {
  index: number;
  hash: string;
  previousHash: string;
  payload: string;
  timestamp: string;
};

export default function TamperDemo({ blocks }: { blocks: Block[] }) {
  const [tamperedIndex, setTamperedIndex] = useState<number | null>(null);
  const [tamperedPayload, setTamperedPayload] = useState<string>("");

  if (blocks.length === 0) {
    return null;
  }

  function simulateTamper(blockIndex: number) {
    const target = blocks.find((b) => b.index === blockIndex);
    if (!target) return;
    setTamperedIndex(blockIndex);
    setTamperedPayload(`${target.payload} [TAMPERED]`);
  }

  function resetTamper() {
    setTamperedIndex(null);
    setTamperedPayload("");
  }

  return (
    <div className="election-record" style={{ marginTop: "2rem", border: "1px solid var(--border-color, #333)" }}>
      <div className="record-heading">
        <div>
          <span className="record-id">PHASE 10 SECURITY MODULE</span>
          <h3 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <ShieldAlert size={18} color="#eab308" />
            Controlled Tamper Detection Demonstration
          </h3>
          <p className="record-description">
            Test the cryptographic ledger&apos;s sensitivity to unauthorized alterations. Modifying any block payload will immediately break the SHA-256 hash reference.
          </p>
        </div>
        <span className={`election-status ${tamperedIndex !== null ? "status-closed" : "status-active"}`}>
          <i />
          {tamperedIndex !== null ? "TAMPER DETECTED" : "INTEGRITY INTACT"}
        </span>
      </div>

      <div style={{ marginTop: "1rem", display: "grid", gap: "1rem" }}>
        {blocks.slice(0, 3).map((block) => {
          const isTampered = tamperedIndex === block.index;
          return (
            <div
              key={block.index}
              className="candidate-readonly"
              style={{
                flexDirection: "column",
                alignItems: "stretch",
                borderLeft: isTampered ? "3px solid #ef4444" : "3px solid #10b981",
                padding: "0.75rem 1rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="candidate-order">Block #{block.index}</span>
                <span style={{ fontSize: "0.8rem", color: isTampered ? "#ef4444" : "#10b981", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                  {isTampered ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                  {isTampered ? "STATUS: INTEGRITY VIOLATION" : "HASH VERIFIED"}
                </span>
              </div>

              <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", fontFamily: "monospace", wordBreak: "break-all" }}>
                <div><strong>Recorded Hash:</strong> {block.hash}</div>
                {isTampered && (
                  <div style={{ color: "#ef4444", marginTop: "0.25rem" }}>
                    <strong>Tampered Hash:</strong> sha256:{tamperedPayload.slice(0, 32)}... [MISMATCH]
                  </div>
                )}
                <div style={{ color: "var(--muted, #888)", marginTop: "0.25rem" }}>
                  <strong>Payload:</strong> {isTampered ? tamperedPayload : block.payload.slice(0, 80)}...
                </div>
              </div>

              <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
                {!isTampered ? (
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
                    onClick={() => simulateTamper(block.index)}
                  >
                    Simulate Tampering with Block #{block.index}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary-button"
                    style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
                    onClick={resetTamper}
                  >
                    <RefreshCw size={13} style={{ marginRight: "0.25rem" }} />
                    Reset to Authentic State
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
