import assert from "node:assert/strict";
import test from "node:test";

import { buildElectionQrReference, buildVerificationUrl } from "./qr";

test("creates a deterministic verification URL for an election", () => {
  const url = buildVerificationUrl("elec-123");

  assert.equal(url.startsWith("http://localhost:3000/verify?ref="), true);
  assert.equal(url.includes("elec-123"), true);
});

test("creates a compact QR payload that encodes the election reference", () => {
  const qr = buildElectionQrReference({
    electionId: "elec-123",
    status: "RESULTS_PUBLISHED",
    digest: "sha256:test-digest",
  });

  assert.equal(qr.startsWith("http://localhost:3000/verify?ref="), true);
  assert.equal(qr.includes("elec-123"), true);
  assert.equal(qr.includes("RESULTS_PUBLISHED"), true);
});
