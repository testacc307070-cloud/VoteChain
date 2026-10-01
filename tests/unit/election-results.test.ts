import assert from "node:assert/strict";
import test from "node:test";

import { createElectionAuditDigest, summarizeElectionResults } from "@/verification/results";

test("summarizes candidate totals without exposing individual voter identities", () => {
  const summary = summarizeElectionResults(
    [
      { id: "cand-1", name: "Alice" },
      { id: "cand-2", name: "Bob" },
      { id: "cand-3", name: "Cara" },
    ],
    [
      { candidateId: "cand-1" },
      { candidateId: "cand-1" },
      { candidateId: "cand-2" },
      { candidateId: "cand-2" },
      { candidateId: "cand-2" },
    ],
  );

  assert.equal(summary.totalVotes, 5);
  assert.equal(summary.candidateResults[0].voteCount, 3);
  assert.equal(summary.candidateResults[1].voteCount, 2);
  assert.equal(summary.winner?.candidateId, "cand-2");
  assert.equal(summary.winner?.name, "Bob");
});

test("creates a public audit digest from non-sensitive totals", () => {
  const digest = createElectionAuditDigest({
    electionId: "election-123",
    totalVotes: 5,
    candidateResults: [
      { candidateId: "cand-1", name: "Alice", voteCount: 2 },
      { candidateId: "cand-2", name: "Bob", voteCount: 3 },
    ],
    publishedAt: new Date("2026-09-26T13:00:00.000Z"),
  });

  assert.equal(typeof digest, "string");
  assert.equal(digest.length >= 32, true);
  assert.equal(digest.startsWith("sha256:"), true);
});
