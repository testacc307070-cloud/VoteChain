import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { prisma } from "./prisma";
import { parseEligibilityCsv } from "./csv-eligibility";
import {
  checkVoterElectionEligibility,
  importElectionEligibilityList,
} from "./eligibility";
import { ElectionStatus } from "@prisma/client";

const TEST_ELECTION_1_ID = "test_eligibility_elec_1";
const TEST_ELECTION_2_ID = "test_eligibility_elec_2";

async function cleanupEligibilityTest() {
  await prisma.electionEligibleVoter.deleteMany({
    where: { electionId: { in: [TEST_ELECTION_1_ID, TEST_ELECTION_2_ID] } },
  });
  await prisma.election.deleteMany({
    where: { id: { in: [TEST_ELECTION_1_ID, TEST_ELECTION_2_ID] } },
  });
}

before(async () => {
  await cleanupEligibilityTest();

  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });

  // Create two distinct test elections to verify election-specific eligibility lists
  await prisma.election.create({
    data: {
      id: TEST_ELECTION_1_ID,
      name: "Class A Representative Election",
      description: "Class A official election",
      startTime: new Date(),
      endTime: new Date(Date.now() + 86400000),
      status: ElectionStatus.ACTIVE,
      createdById: admin.id,
      candidates: {
        create: [
          { name: "Candidate 1A", sortOrder: 1 },
          { name: "Candidate 1B", sortOrder: 2 },
        ],
      },
    },
  });

  await prisma.election.create({
    data: {
      id: TEST_ELECTION_2_ID,
      name: "Class B Representative Election",
      description: "Class B official election",
      startTime: new Date(),
      endTime: new Date(Date.now() + 86400000),
      status: ElectionStatus.ACTIVE,
      createdById: admin.id,
      candidates: {
        create: [
          { name: "Candidate 2A", sortOrder: 1 },
          { name: "Candidate 2B", sortOrder: 2 },
        ],
      },
    },
  });
});

after(async () => {
  await cleanupEligibilityTest();
  await prisma.$disconnect();
});

test("Phase 2: CSV Parser accepts valid student_id,email format", () => {
  const csv = `student_id,email
24n236,24n236@psgtech.ac.in
24n237,24n237@psgtech.ac.in
24n238,24n238@psgtech.ac.in`;

  const parsed = parseEligibilityCsv(csv);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.records.length, 3);
    assert.equal(parsed.records[0].studentId, "24N236");
    assert.equal(parsed.records[0].email, "24n236@psgtech.ac.in");
    assert.equal(parsed.duplicatesCount, 0);
  }
});

test("Phase 2: CSV Parser detects and deduplicates duplicate entries", () => {
  const csv = `student_id,email
24n236,24n236@psgtech.ac.in
24n236,24n236@psgtech.ac.in
24n237,24n237@psgtech.ac.in
24n237,24n237@psgtech.ac.in`;

  const parsed = parseEligibilityCsv(csv);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.records.length, 2);
    assert.equal(parsed.duplicatesCount, 2);
  }
});

test("Phase 2: Invalid CSV blocked (missing headers, invalid domain, malformed)", () => {
  // Missing headers
  const missingHeaders = `24n236,24n236@psgtech.ac.in`;
  const res1 = parseEligibilityCsv(missingHeaders);
  assert.equal(res1.ok, false);
  assert.ok(res1.error.includes("header"));

  // Non-PSG domain in CSV
  const invalidDomain = `student_id,email
24n236,student@gmail.com`;
  const res2 = parseEligibilityCsv(invalidDomain);
  assert.equal(res2.ok, false);
  assert.ok(res2.errors.some((e) => e.includes("@psgtech.ac.in")));

  // Invalid student ID
  const invalidId = `student_id,email
???,24n236@psgtech.ac.in`;
  const res3 = parseEligibilityCsv(invalidId);
  assert.equal(res3.ok, false);
  assert.ok(res3.errors.some((e) => e.includes("Invalid Student ID")));

  // Empty CSV
  const res4 = parseEligibilityCsv("");
  assert.equal(res4.ok, false);
});

test("Phase 2: Admin imports class eligibility lists per election", async () => {
  const classA = [
    { studentId: "24N236", email: "24n236@psgtech.ac.in" },
    { studentId: "24N237", email: "24n237@psgtech.ac.in" },
  ];

  const classB = [
    { studentId: "24N301", email: "24n301@psgtech.ac.in" },
    { studentId: "24N302", email: "24n302@psgtech.ac.in" },
  ];

  const resA = await importElectionEligibilityList(TEST_ELECTION_1_ID, classA, "admin@votechain.local");
  assert.equal(resA.count, 2);

  const resB = await importElectionEligibilityList(TEST_ELECTION_2_ID, classB, "admin@votechain.local");
  assert.equal(resB.count, 2);

  // Check database count
  const countA = await prisma.electionEligibleVoter.count({ where: { electionId: TEST_ELECTION_1_ID } });
  const countB = await prisma.electionEligibleVoter.count({ where: { electionId: TEST_ELECTION_2_ID } });
  assert.equal(countA, 2);
  assert.equal(countB, 2);
});

test("Phase 2: Eligible student is allowed to vote", async () => {
  // Student 24N236 with verified email is on Election 1's list
  const result = await checkVoterElectionEligibility({
    userId: "voter-user-1",
    email: "24n236@psgtech.ac.in",
    voterId: "24N236",
    role: "VOTER",
    emailVerified: true,
    electionId: TEST_ELECTION_1_ID,
  });

  assert.equal(result.ok, true);
});

test("Phase 2: Non-eligible student is blocked", async () => {
  // Student 24N999 is NOT in Election 1's list
  const result = await checkVoterElectionEligibility({
    userId: "voter-user-999",
    email: "24n999@psgtech.ac.in",
    voterId: "24N999",
    role: "VOTER",
    emailVerified: true,
    electionId: TEST_ELECTION_1_ID,
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "NOT_IN_ELIGIBILITY_LIST");
});

test("Phase 2: Wrong Student ID / Email mismatch is blocked", async () => {
  // Email matches 24n236@psgtech.ac.in, but Student ID is forged / wrong (24N999 instead of 24N236)
  const result = await checkVoterElectionEligibility({
    userId: "voter-user-mismatch",
    email: "24n236@psgtech.ac.in",
    voterId: "24N999", // Mismatch with official class list entry (24N236)
    role: "VOTER",
    emailVerified: true,
    electionId: TEST_ELECTION_1_ID,
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "STUDENT_ID_MISMATCH");
  assert.ok(result.reason?.includes("Student ID mismatch"));
});

test("Phase 2: Unverified student is blocked even if in eligibility list", async () => {
  // Student is in the list, but hasn't verified their email
  const result = await checkVoterElectionEligibility({
    userId: "voter-user-unverified",
    email: "24n236@psgtech.ac.in",
    voterId: "24N236",
    role: "VOTER",
    emailVerified: false,
    electionId: TEST_ELECTION_1_ID,
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "UNVERIFIED_EMAIL");
});

test("Phase 2: Election-specific lists work (Class A allowed in Elec 1, blocked in Elec 2)", async () => {
  // Student 24N236 is in Class A (Election 1)
  const checkInElec1 = await checkVoterElectionEligibility({
    userId: "voter-user-236",
    email: "24n236@psgtech.ac.in",
    voterId: "24N236",
    role: "VOTER",
    emailVerified: true,
    electionId: TEST_ELECTION_1_ID,
  });
  assert.equal(checkInElec1.ok, true, "Student 24N236 must be allowed in Election 1");

  const checkInElec2 = await checkVoterElectionEligibility({
    userId: "voter-user-236",
    email: "24n236@psgtech.ac.in",
    voterId: "24N236",
    role: "VOTER",
    emailVerified: true,
    electionId: TEST_ELECTION_2_ID,
  });
  assert.equal(checkInElec2.ok, false, "Student 24N236 must be blocked in Election 2 (Class B)");
  assert.equal(checkInElec2.errorCode, "NOT_IN_ELIGIBILITY_LIST");

  // Student 24N301 is in Class B (Election 2)
  const checkStudent301InElec1 = await checkVoterElectionEligibility({
    userId: "voter-user-301",
    email: "24n301@psgtech.ac.in",
    voterId: "24N301",
    role: "VOTER",
    emailVerified: true,
    electionId: TEST_ELECTION_1_ID,
  });
  assert.equal(checkStudent301InElec1.ok, false, "Student 24N301 must be blocked in Election 1");

  const checkStudent301InElec2 = await checkVoterElectionEligibility({
    userId: "voter-user-301",
    email: "24n301@psgtech.ac.in",
    voterId: "24N301",
    role: "VOTER",
    emailVerified: true,
    electionId: TEST_ELECTION_2_ID,
  });
  assert.equal(checkStudent301InElec2.ok, true, "Student 24N301 must be allowed in Election 2");
});
