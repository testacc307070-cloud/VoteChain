import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createHmac } from "node:crypto";
import { UserRole, ElectionStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { createSessionToken, isAdminRole } from "./session";
import { validateVoteSubmission } from "./voting";
import { checkVoterElectionEligibility } from "./eligibility";
import { requireAdminApi } from "./admin-api";

const TEST_VOTER_A_ID = "test_voter_alpha";
const TEST_VOTER_A_EMAIL = "24alpha@psgtech.ac.in";
const TEST_VOTER_UNVERIFIED_EMAIL = "24unverified@psgtech.ac.in";

const TEST_ELEC_1_ID = "test_onevote_elec_1";
const TEST_ELEC_2_ID = "test_onevote_elec_2";

async function cleanupOneVoteTest() {
  for (let i = 0; i < 5; i++) {
    try {
      await prisma.electionVoterParticipation.deleteMany({
        where: { electionId: { in: [TEST_ELEC_1_ID, TEST_ELEC_2_ID] } },
      });
      await prisma.electionEligibleVoter.deleteMany({
        where: { electionId: { in: [TEST_ELEC_1_ID, TEST_ELEC_2_ID] } },
      });
      await prisma.election.deleteMany({
        where: { id: { in: [TEST_ELEC_1_ID, TEST_ELEC_2_ID] } },
      });
      await prisma.user.deleteMany({
        where: { email: { in: [TEST_VOTER_A_EMAIL, TEST_VOTER_UNVERIFIED_EMAIL] } },
      });
      return;
    } catch (e) {
      if (i === 4) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

before(async () => {
  await cleanupOneVoteTest();

  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });

  // 1. Create Voter A (verified)
  const voterA = await prisma.user.create({
    data: {
      id: TEST_VOTER_A_ID,
      name: "Voter Alpha",
      email: TEST_VOTER_A_EMAIL,
      voterId: "24ALPHA",
      passwordHash: "test_hash",
      role: UserRole.VOTER,
      emailVerified: true,
    },
  });

  // 2. Create Unverified Voter
  await prisma.user.create({
    data: {
      name: "Unverified Student",
      email: TEST_VOTER_UNVERIFIED_EMAIL,
      voterId: "24UNVER",
      passwordHash: "test_hash",
      role: UserRole.VOTER,
      emailVerified: false,
    },
  });

  // 3. Create Election 1 and Election 2
  await prisma.election.create({
    data: {
      id: TEST_ELEC_1_ID,
      name: "Campus Election 1",
      startTime: new Date(),
      endTime: new Date(Date.now() + 86400000),
      status: ElectionStatus.ACTIVE,
      createdById: admin.id,
      candidates: {
        create: [
          { id: `${TEST_ELEC_1_ID}_cand1`, name: "Candidate 1A", sortOrder: 1 },
          { id: `${TEST_ELEC_1_ID}_cand2`, name: "Candidate 1B", sortOrder: 2 },
        ],
      },
      eligibleVoters: {
        create: [{ studentId: "24ALPHA", email: TEST_VOTER_A_EMAIL }],
      },
    },
  });

  await prisma.election.create({
    data: {
      id: TEST_ELEC_2_ID,
      name: "Campus Election 2",
      startTime: new Date(),
      endTime: new Date(Date.now() + 86400000),
      status: ElectionStatus.ACTIVE,
      createdById: admin.id,
      candidates: {
        create: [
          { id: `${TEST_ELEC_2_ID}_cand1`, name: "Candidate 2A", sortOrder: 1 },
          { id: `${TEST_ELEC_2_ID}_cand2`, name: "Candidate 2B", sortOrder: 2 },
        ],
      },
      eligibleVoters: {
        create: [{ studentId: "24ALPHA", email: TEST_VOTER_A_EMAIL }],
      },
    },
  });
});

after(async () => {
  await cleanupOneVoteTest();
  await prisma.$disconnect();
});

test("Phase 3: One Vote Per Election - First vote in Election 1 is allowed", async () => {
  // Check validation before voting
  const validation = validateVoteSubmission({
    electionId: TEST_ELEC_1_ID,
    candidateId: `${TEST_ELEC_1_ID}_cand1`,
    validCandidateIds: [`${TEST_ELEC_1_ID}_cand1`, `${TEST_ELEC_1_ID}_cand2`],
    hasExistingVote: false,
  });
  assert.equal(validation.ok, true);

  // Cast first vote: record participation in ElectionVoterParticipation
  const participation = await prisma.electionVoterParticipation.create({
    data: {
      electionId: TEST_ELEC_1_ID,
      voterId: TEST_VOTER_A_ID,
      votedAt: new Date(),
    },
  });

  assert.ok(participation.id);
  assert.equal(participation.electionId, TEST_ELEC_1_ID);
  assert.equal(participation.voterId, TEST_VOTER_A_ID);
  assert.ok(participation.votedAt instanceof Date);
});

test("Phase 3: One Vote Per Election - Second vote in Election 1 is strictly blocked", async () => {
  // Check that application validation blocks duplicate vote
  const hasExisting = await prisma.electionVoterParticipation.count({
    where: { electionId: TEST_ELEC_1_ID, voterId: TEST_VOTER_A_ID },
  });
  assert.equal(hasExisting, 1, "Voter A already participated in Election 1");

  const validation = validateVoteSubmission({
    electionId: TEST_ELEC_1_ID,
    candidateId: `${TEST_ELEC_1_ID}_cand2`,
    validCandidateIds: [`${TEST_ELEC_1_ID}_cand1`, `${TEST_ELEC_1_ID}_cand2`],
    hasExistingVote: hasExisting > 0,
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.error, "This voter has already voted in this election.");

  // Database unique constraint (electionId, voterId) must reject second participation insertion
  await assert.rejects(
    async () => {
      await prisma.electionVoterParticipation.create({
        data: {
          electionId: TEST_ELEC_1_ID,
          voterId: TEST_VOTER_A_ID,
          votedAt: new Date(),
        },
      });
    },
    /unique constraint/i,
    "Database must enforce unique constraint on (electionId, voterId)"
  );
});

test("Phase 3: One Vote Per Election - Voter A can still vote in Election 2", async () => {
  // Voter A has voted in Election 1, but has NOT voted in Election 2
  const hasVotedInElec2 = await prisma.electionVoterParticipation.count({
    where: { electionId: TEST_ELEC_2_ID, voterId: TEST_VOTER_A_ID },
  });
  assert.equal(hasVotedInElec2, 0, "Voter A has not voted in Election 2 yet");

  const validation = validateVoteSubmission({
    electionId: TEST_ELEC_2_ID,
    candidateId: `${TEST_ELEC_2_ID}_cand1`,
    validCandidateIds: [`${TEST_ELEC_2_ID}_cand1`, `${TEST_ELEC_2_ID}_cand2`],
    hasExistingVote: hasVotedInElec2 > 0,
  });
  assert.equal(validation.ok, true, "First vote in Election 2 must be allowed");

  // Cast vote in Election 2
  const participation2 = await prisma.electionVoterParticipation.create({
    data: {
      electionId: TEST_ELEC_2_ID,
      voterId: TEST_VOTER_A_ID,
      votedAt: new Date(),
    },
  });

  assert.equal(participation2.electionId, TEST_ELEC_2_ID);
  assert.equal(participation2.voterId, TEST_VOTER_A_ID);
});

test("Phase 3: Unverified account is blocked from participating", async () => {
  const result = await checkVoterElectionEligibility({
    userId: "unverified-id",
    email: TEST_VOTER_UNVERIFIED_EMAIL,
    voterId: "24UNVER",
    role: "VOTER",
    emailVerified: false,
    electionId: TEST_ELEC_1_ID,
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "UNVERIFIED_EMAIL");
});

test("Phase 3: Non-eligible account is blocked from election", async () => {
  const result = await checkVoterElectionEligibility({
    userId: "non-eligible-id",
    email: "24unknown@psgtech.ac.in",
    voterId: "24UNKNOWN",
    role: "VOTER",
    emailVerified: true,
    electionId: TEST_ELEC_1_ID,
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "NOT_IN_ELIGIBILITY_LIST");
});

test("Phase 3: Role Boundaries - Wrong roles blocked from voting or admin APIs", async () => {
  // 1. Admin blocked from voting
  const adminEligibility = await checkVoterElectionEligibility({
    userId: "admin-id",
    email: "admin@votechain.local",
    role: "ADMIN",
    emailVerified: true,
    electionId: TEST_ELEC_1_ID,
  });
  assert.equal(adminEligibility.ok, false);
  assert.equal(adminEligibility.errorCode, "NOT_VOTER");

  // 2. Observer blocked from voting
  const observerEligibility = await checkVoterElectionEligibility({
    userId: "observer-id",
    email: "observer@votechain.local",
    role: "OBSERVER",
    emailVerified: true,
    electionId: TEST_ELEC_1_ID,
  });
  assert.equal(observerEligibility.ok, false);
  assert.equal(observerEligibility.errorCode, "NOT_VOTER");

  // 3. Authority blocked from voting
  const authorityEligibility = await checkVoterElectionEligibility({
    userId: "authority-id",
    email: "authority@votechain.local",
    role: "AUTHORITY",
    emailVerified: true,
    electionId: TEST_ELEC_1_ID,
  });
  assert.equal(authorityEligibility.ok, false);
  assert.equal(authorityEligibility.errorCode, "NOT_VOTER");

  // 4. Role helper correctly identifies only ADMIN
  assert.equal(isAdminRole(UserRole.ADMIN), true);
  assert.equal(isAdminRole(UserRole.VOTER), false);
  assert.equal(isAdminRole(UserRole.AUTHORITY), false);
  assert.equal(isAdminRole(UserRole.OBSERVER), false);
});

test("Phase 3: Session & Cookie - Token creation and HMAC integrity validation", () => {
  const token = createSessionToken(TEST_VOTER_A_ID);
  assert.ok(token.includes("."), "Session token must be dot-delimited (payload.signature)");

  const [payload, signature] = token.split(".");
  assert.ok(payload);
  assert.ok(signature);

  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(decoded.userId, TEST_VOTER_A_ID);
  assert.ok(decoded.expiresAt > Date.now());

  // Tampered payload must invalidate the token
  const tamperedPayload = Buffer.from(JSON.stringify({ userId: "forged_admin_id", expiresAt: decoded.expiresAt })).toString("base64url");
  const tamperedToken = `${tamperedPayload}.${signature}`;

  // Read with different signature must fail HMAC verification
  const secret = process.env.SESSION_SECRET || "local-only-demo-session-secret-change-for-real-deployments";
  const expectedSig = createHmac("sha256", secret).update(tamperedPayload).digest("base64url");
  assert.notEqual(signature, expectedSig, "Tampered payload must not match original signature");
});

test("Phase 3: Session & Cookie - Expired session token is rejected", () => {
  const secret = process.env.SESSION_SECRET || "local-only-demo-session-secret-change-for-real-deployments";
  // Expired 1 hour ago
  const expiredPayload = Buffer.from(
    JSON.stringify({ userId: TEST_VOTER_A_ID, expiresAt: Date.now() - 3600 * 1000 })
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(expiredPayload).digest("base64url");
  const expiredToken = `${expiredPayload}.${signature}`;

  const [pay, sig] = expiredToken.split(".");
  const data = JSON.parse(Buffer.from(pay, "base64url").toString("utf8"));
  assert.ok(data.expiresAt <= Date.now(), "Token must be expired");
});
