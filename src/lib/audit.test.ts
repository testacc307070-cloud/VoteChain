import assert from "node:assert/strict";
import test from "node:test";

import { buildElectionAuditTrail } from "./audit";

test("builds a privacy-safe audit trail for a closed election", () => {
  const trail = buildElectionAuditTrail({
    electionId: "election-123",
    electionName: "Student Council",
    startTime: new Date("2026-09-20T09:00:00.000Z"),
    endTime: new Date("2026-09-26T18:00:00.000Z"),
    publishedAt: new Date("2026-09-26T19:00:00.000Z"),
    totalVotes: 42,
    digest: "sha256:abc123",
  });

  assert.equal(trail.length, 4);
  assert.equal(trail[0].title, "Election created");
  assert.equal(trail[trail.length - 1].title, "Results published");
  assert.equal(trail[trail.length - 1].detail.includes("42"), true);
});
