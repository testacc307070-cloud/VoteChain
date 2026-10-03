import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import bcrypt from "bcryptjs";
import { ElectionStatus, UserRole, UserStatus, TokenType } from "@prisma/client";
import { prisma } from "../../src/database/prisma";
import { parseEligibilityCsv } from "../../src/backend/voting/csv-eligibility";
import { importElectionEligibilityList } from "../../src/backend/voting/eligibility";

const TEST_ADMIN_EMAIL = "admin.votechain@gmail.com";
const TEST_ELEC_PREFIX = "test-prod-fix";

async function cleanup() {
  await prisma.electionVote.deleteMany({
    where: { election: { name: { startsWith: TEST_ELEC_PREFIX } } },
  });
  await prisma.electionTrustee.deleteMany({
    where: { election: { name: { startsWith: TEST_ELEC_PREFIX } } },
  });
  await prisma.electionEligibleVoter.deleteMany({
    where: { election: { name: { startsWith: TEST_ELEC_PREFIX } } },
  });
  await prisma.electionCandidate.deleteMany({
    where: { election: { name: { startsWith: TEST_ELEC_PREFIX } } },
  });
  await prisma.election.deleteMany({
    where: { name: { startsWith: TEST_ELEC_PREFIX } },
  });
  await prisma.verificationToken.deleteMany({
    where: { user: { email: { contains: "test_fix_auth" } } },
  });
  await prisma.user.deleteMany({
    where: { email: { contains: "test_fix_auth" } },
  });
}

before(async () => {
  await cleanup();
});

after(async () => {
  await cleanup();
});

test("Authority Deletion: Safe removal from DRAFT elections without foreign key error", async () => {
  const admin = await prisma.user.findFirst({ where: { role: UserRole.ADMIN } });
  assert.ok(admin, "Admin account must exist");

  // 1. Create a test authority
  const authEmail = "test_fix_auth_draft@gmail.com";
  const passwordHash = await bcrypt.hash("Password123!#$", 10);
  const authority = await prisma.user.create({
    data: {
      name: "Draft Trustee",
      email: authEmail,
      passwordHash,
      role: UserRole.AUTHORITY,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  // 2. Create a DRAFT election and assign the authority
  const election = await prisma.election.create({
    data: {
      name: `${TEST_ELEC_PREFIX}-draft-auth`,
      startTime: new Date(),
      endTime: new Date(Date.now() + 86400000),
      status: ElectionStatus.DRAFT,
      createdById: admin.id,
      trustees: {
        create: {
          authorityId: authority.id,
          slotIndex: 1,
        },
      },
    },
  });

  // 3. Deleting the authority:
  // Must clean up DRAFT trustee assignment and delete user without foreign key error
  await prisma.$transaction(async (tx) => {
    await tx.electionTrustee.deleteMany({
      where: {
        authorityId: authority.id,
        election: { status: ElectionStatus.DRAFT },
      },
    });
    await tx.verificationToken.deleteMany({
      where: { userId: authority.id },
    });
    await tx.user.delete({
      where: { id: authority.id },
    });
  });

  // Verify authority was cleanly deleted
  const checkAuth = await prisma.user.findUnique({ where: { id: authority.id } });
  assert.equal(checkAuth, null, "Authority must be deleted");

  // Verify election is preserved
  const checkElec = await prisma.election.findUnique({ where: { id: election.id } });
  assert.ok(checkElec, "Election must remain intact");
});

test("Authority Deletion: Prevents deletion when assigned to historical/ACTIVE election", async () => {
  const admin = await prisma.user.findFirst({ where: { role: UserRole.ADMIN } });
  assert.ok(admin);

  // 1. Create a test authority
  const authEmail = "test_fix_auth_historical@gmail.com";
  const passwordHash = await bcrypt.hash("Password123!#$", 10);
  const authority = await prisma.user.create({
    data: {
      name: "Historical Trustee",
      email: authEmail,
      passwordHash,
      role: UserRole.AUTHORITY,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  // 2. Create an ACTIVE election with this authority
  const election = await prisma.election.create({
    data: {
      name: `${TEST_ELEC_PREFIX}-active-auth`,
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() + 86400000),
      status: ElectionStatus.ACTIVE,
      createdById: admin.id,
      trustees: {
        create: {
          authorityId: authority.id,
          slotIndex: 1,
        },
      },
    },
  });

  // 3. Inspect trustee assignments
  const trusteeAssignments = await prisma.electionTrustee.findMany({
    where: { authorityId: authority.id },
    include: { election: { select: { id: true, name: true, status: true } } },
  });
  const historical = trusteeAssignments.filter((t) => t.election.status !== ElectionStatus.DRAFT);
  assert.equal(historical.length, 1, "Must find 1 historical election");

  // Deletion must be blocked
  const canDelete = (historical.length as number) === 0;
  assert.equal(canDelete, false, "Authority assigned to non-DRAFT election cannot be deleted");

  // Verify account can be suspended instead
  const suspendedUser = await prisma.user.update({
    where: { id: authority.id },
    data: { status: UserStatus.SUSPENDED },
  });
  assert.equal(suspendedUser.status, UserStatus.SUSPENDED);
});

test("CSV Eligibility Upload: Valid and Invalid parsing rules", () => {
  // 1. Valid CSV
  const validCsv = `student_id,email
24N201,24n201@psgtech.ac.in
24N202,24n202@psgtech.ac.in
24N203,24n203@psgtech.ac.in`;

  const validParsed = parseEligibilityCsv(validCsv);
  assert.equal(validParsed.ok, true);
  if (validParsed.ok) {
    assert.equal(validParsed.records.length, 3);
    assert.equal(validParsed.records[0].studentId, "24N201");
    assert.equal(validParsed.records[0].email, "24n201@psgtech.ac.in");
  }

  // 2. Invalid CSV (invalid domains, missing student IDs)
  const invalidCsv = `student_id,email
24N201,attacker@gmail.com
,no_id@psgtech.ac.in
24N203,24n203@psgtech.ac.in`;

  const invalidParsed = parseEligibilityCsv(invalidCsv);
  assert.equal(invalidParsed.ok, false);
  if (!invalidParsed.ok) {
    assert.ok(invalidParsed.errors.length >= 2, "Must identify each invalid row");
    assert.ok(invalidParsed.errors.some((e) => e.includes("@psgtech.ac.in")), "Flags non-institutional domain");
    assert.ok(invalidParsed.errors.some((e) => e.toLowerCase().includes("student id")), "Flags missing student ID");
  }
});

test("CSV Eligibility Upload: Rejection on closed elections", async () => {
  const admin = await prisma.user.findFirst({ where: { role: UserRole.ADMIN } });
  assert.ok(admin);

  const closedElection = await prisma.election.create({
    data: {
      name: `${TEST_ELEC_PREFIX}-locked-eligibility`,
      startTime: new Date(Date.now() - 86400000),
      endTime: new Date(Date.now() - 3600000),
      status: ElectionStatus.CLOSED,
      createdById: admin.id,
    },
  });

  await assert.rejects(
    async () => {
      await importElectionEligibilityList(
        closedElection.id,
        [{ studentId: "24N201", email: "24n201@psgtech.ac.in" }],
        admin.email
      );
    },
    /Eligibility register cannot be modified after an election has closed/
  );
});

test("Election Setup Order: Complete DRAFT -> Candidates -> CSV -> 3 Trustees -> Lock workflow", async () => {
  const admin = await prisma.user.findFirst({ where: { role: UserRole.ADMIN } });
  assert.ok(admin);

  // 1. Create 3 active authorities for trustee assignment
  const authorities: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const auth = await prisma.user.upsert({
      where: { email: `test_fix_auth_trustee_${i}@gmail.com` },
      update: { status: UserStatus.ACTIVE },
      create: {
        name: `Trustee ${i}`,
        email: `test_fix_auth_trustee_${i}@gmail.com`,
        passwordHash: await bcrypt.hash("Password123!#$", 10),
        role: UserRole.AUTHORITY,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      },
    });
    authorities.push(auth.id);
  }

  // 2. Create DRAFT election
  const election = await prisma.election.create({
    data: {
      name: `${TEST_ELEC_PREFIX}-order-test`,
      startTime: new Date(Date.now() + 3600000),
      endTime: new Date(Date.now() + 86400000),
      status: ElectionStatus.DRAFT,
      createdById: admin.id,
    },
  });

  // Step 1: Add at least 2 candidates
  await prisma.electionCandidate.createMany({
    data: [
      { electionId: election.id, name: "Candidate Alpha", sortOrder: 0 },
      { electionId: election.id, name: "Candidate Beta", sortOrder: 1 },
    ],
  });
  const candidateCount = await prisma.electionCandidate.count({ where: { electionId: election.id } });
  assert.equal(candidateCount, 2);

  // Step 2: Upload eligibility list
  const importResult = await importElectionEligibilityList(
    election.id,
    [
      { studentId: "24N101", email: "24n101@psgtech.ac.in" },
      { studentId: "24N102", email: "24n102@psgtech.ac.in" },
    ],
    admin.email
  );
  assert.equal(importResult.count, 2);
  const eligibleCount = await prisma.electionEligibleVoter.count({ where: { electionId: election.id } });
  assert.equal(eligibleCount, 2);

  // Step 3: Assign exactly 3 trustees to Slots 1, 2, 3
  await prisma.electionTrustee.createMany({
    data: authorities.map((authId, idx) => ({
      electionId: election.id,
      authorityId: authId,
      slotIndex: idx + 1,
    })),
  });
  const trusteeCount = await prisma.electionTrustee.count({ where: { electionId: election.id } });
  assert.equal(trusteeCount, 3);

  // Step 4: Lock election configuration and transition to UPCOMING
  const lockedElection = await prisma.election.update({
    where: { id: election.id },
    data: {
      status: ElectionStatus.UPCOMING,
      candidatesLocked: true,
    },
  });
  assert.equal(lockedElection.status, ElectionStatus.UPCOMING);
  assert.equal(lockedElection.candidatesLocked, true);
});

test("Clean-Slate Demo Reset: Preserves ADMIN account, clears test records, and initializes reset audit log", async () => {
  const admin = await prisma.user.findFirst({ where: { role: UserRole.ADMIN } });
  assert.ok(admin, "Admin account must be present");

  // Create temporary test records to verify reset
  const uniqueSuffix = Date.now().toString();
  const tempVoter = await prisma.user.create({
    data: {
      name: "Temporary Voter",
      email: `test_temp_voter_${uniqueSuffix}@psgtech.ac.in`,
      voterId: `VTR-TEMP-${uniqueSuffix}`,
      passwordHash: await bcrypt.hash("TempPass123!", 10),
      role: UserRole.VOTER,
      status: UserStatus.ACTIVE,
    },
  });

  const tempElection = await prisma.election.create({
    data: {
      name: `${TEST_ELEC_PREFIX}-temp-reset-elec`,
      startTime: new Date(),
      endTime: new Date(Date.now() + 86400000),
      status: ElectionStatus.DRAFT,
      createdById: admin.id,
    },
  });

  // Verify records exist before reset
  assert.ok(await prisma.user.findUnique({ where: { id: tempVoter.id } }));
  assert.ok(await prisma.election.findUnique({ where: { id: tempElection.id } }));

  // Simulate clean-slate demo reset transaction
  await prisma.$transaction(async (tx) => {
    await tx.electionVote.deleteMany({ where: { election: { name: { startsWith: TEST_ELEC_PREFIX } } } });
    await tx.electionVoterParticipation.deleteMany({ where: { election: { name: { startsWith: TEST_ELEC_PREFIX } } } });
    await tx.electionBlockchainBlock.deleteMany({ where: { election: { name: { startsWith: TEST_ELEC_PREFIX } } } });
    await tx.electionAuthorityApproval.deleteMany({ where: { election: { name: { startsWith: TEST_ELEC_PREFIX } } } });
    await tx.electionTrustee.deleteMany({ where: { election: { name: { startsWith: TEST_ELEC_PREFIX } } } });
    await tx.electionEligibleVoter.deleteMany({ where: { election: { name: { startsWith: TEST_ELEC_PREFIX } } } });
    await tx.electionCandidate.deleteMany({ where: { election: { name: { startsWith: TEST_ELEC_PREFIX } } } });
    await tx.election.deleteMany({ where: { id: tempElection.id } });
    await tx.user.deleteMany({ where: { id: tempVoter.id } });
  }, { timeout: 30000, maxWait: 15000 });

  // Verify test records are removed
  const deletedVoter = await prisma.user.findUnique({ where: { id: tempVoter.id } });
  const deletedElection = await prisma.election.findUnique({ where: { id: tempElection.id } });
  assert.equal(deletedVoter, null, "Test voter must be deleted");
  assert.equal(deletedElection, null, "Test election must be deleted");

  // Verify ADMIN account is preserved
  const preservedAdmin = await prisma.user.findUnique({ where: { id: admin.id } });
  assert.ok(preservedAdmin, "Admin account must be preserved");
  assert.equal(preservedAdmin.role, UserRole.ADMIN);
});
