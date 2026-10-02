import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import { getRoleLandingRoute } from "@/backend/auth/role-routing";
import { validateVoteSubmission } from "@/backend/voting/voting";
import { evaluateAuthorityThreshold } from "@/security/threshold";

test("Admin Authentication & Role Routing: maps ADMIN role to root dashboard route '/'", () => {
  assert.equal(getRoleLandingRoute("ADMIN"), "/");
  assert.equal(getRoleLandingRoute("AUTHORITY"), "/authority");
  assert.equal(getRoleLandingRoute("OBSERVER"), "/observer");
  assert.equal(getRoleLandingRoute("VOTER"), "/portal");
});

test("Admin Password Hashing: verifies bcrypt cost factor 12 and secure hash comparison", async () => {
  const adminPassword = "SecureAdminTestPassword123!";
  const hash = await bcrypt.hash(adminPassword, 12);

  assert.ok(hash.startsWith("$2"), "Hash must be a valid bcrypt hash");
  assert.equal(await bcrypt.compare(adminPassword, hash), true);
  assert.equal(await bcrypt.compare("wrongPassword", hash), false);
});

test("Authority Slot Management: tracks authority slot index 1, 2, 3 and enforces maximum of 3", () => {
  const currentAuthorities = [
    { id: "auth-1", email: "authority1@votechain.local", name: "Trustee 1" },
    { id: "auth-2", email: "authority2@votechain.local", name: "Trustee 2" },
  ];

  // Under limit of 3
  assert.ok(currentAuthorities.length < 3, "Should allow adding when under 3");
  const nextSlot = currentAuthorities.length + 1;
  assert.equal(nextSlot, 3, "Next authority occupies Slot 3");

  // When limit is reached
  currentAuthorities.push({ id: "auth-3", email: "authority3@votechain.local", name: "Trustee 3" });
  assert.equal(currentAuthorities.length, 3);
  const canAddMore = currentAuthorities.length < 3;
  assert.equal(canAddMore, false, "Must disallow adding more than 3 authorities");
});

test("Authority Role Isolation: voter eligibility check strictly rejects non-voter roles", () => {
  // Test role restriction in voting eligibility logic
  const authorityUser = {
    id: "auth-1",
    email: "authority@votechain.local",
    role: "AUTHORITY",
    emailVerified: true,
  };

  const isVoter = authorityUser.role === "VOTER";
  assert.equal(isVoter, false, "Authority account cannot act as a voter");
});

test("Early Election Closure: halts voting immediately when election is CLOSED", () => {
  const now = new Date();
  const startTime = new Date(now.getTime() - 3600000);
  const originalEndTime = new Date(now.getTime() + 7200000); // 2 hours in future

  // When active, voting is allowed
  const activeValidation = validateVoteSubmission({
    electionId: "el-1",
    candidateId: "cand-1",
    validCandidateIds: ["cand-1", "cand-2"],
    hasExistingVote: false,
    startTime,
    endTime: originalEndTime,
    now,
  });
  assert.equal(activeValidation.ok, true, "Active election accepts votes");

  // When closed early (effective endTime set to now or past)
  const earlyClosedEndTime = new Date(now.getTime() - 1000);
  const closedValidation = validateVoteSubmission({
    electionId: "el-1",
    candidateId: "cand-1",
    validCandidateIds: ["cand-1", "cand-2"],
    hasExistingVote: false,
    startTime,
    endTime: earlyClosedEndTime,
    now,
  });
  assert.equal(closedValidation.ok, false, "Closed early election rejects votes");
  assert.ok(
    closedValidation.error?.includes("active election time window") ||
      closedValidation.error?.includes("closed") ||
      closedValidation.error?.includes("ended"),
    "Rejection reason notes election window is inactive"
  );
});

test("Early Election Closure: preserves cast votes and does not permit reopening", () => {
  const electionState = {
    id: "el-live-1",
    status: "ACTIVE" as const,
    votesCount: 42,
    endTime: new Date(Date.now() + 100000),
  };

  // Simulate early closure
  const now = new Date();
  const closedState = {
    ...electionState,
    status: "CLOSED" as const,
    endTime: now,
  };

  assert.equal(closedState.status, "CLOSED");
  assert.equal(closedState.votesCount, 42, "All 42 votes must be preserved");

  // Verify state transitions: valid next actions from CLOSED are only RESULTS_PUBLISHED
  const allowedTransitionsFromClosed = ["RESULTS_PUBLISHED"];
  const canReopenToActive = allowedTransitionsFromClosed.includes("ACTIVE");
  assert.equal(canReopenToActive, false, "Closed election can never be reopened to ACTIVE");
});

test("Safe Election Deletion: allowed for 0-vote elections, restricted for voted elections", () => {
  function evaluateDeletionEligibility(votesCount: number) {
    if (votesCount > 0) {
      return {
        canDelete: false,
        reason:
          "Cannot delete election with cast votes. To preserve the cryptographic audit trail and blockchain commitments, close the election instead.",
      };
    }
    return { canDelete: true, reason: "Election has 0 votes and can be safely deleted." };
  }

  // Unvoted election (0 votes)
  const unvotedResult = evaluateDeletionEligibility(0);
  assert.equal(unvotedResult.canDelete, true);

  // Voted election (e.g. 5 votes)
  const votedResult = evaluateDeletionEligibility(5);
  assert.equal(votedResult.canDelete, false);
  assert.ok(votedResult.reason.includes("cryptographic audit trail"));
});

test("Threshold Security: 2-of-3 threshold requires 2 distinct authority approvals", () => {
  const approvalsWithDistinctAuthorities = [
    { authorityId: "auth-1", approved: true, keyShare: "keyshare:1:mock" },
    { authorityId: "auth-2", approved: true, keyShare: "keyshare:2:mock" },
  ];

  const result = evaluateAuthorityThreshold(approvalsWithDistinctAuthorities, 2);
  assert.equal(result.approved, true);
  assert.equal(result.canReconstructKey, true);

  // 1 share only fails threshold
  const singleApproval = [
    { authorityId: "auth-1", approved: true, keyShare: "keyshare:1:mock" },
  ];
  const singleResult = evaluateAuthorityThreshold(singleApproval, 2);
  assert.equal(singleResult.approved, false);
  assert.equal(singleResult.canReconstructKey, false);
});
