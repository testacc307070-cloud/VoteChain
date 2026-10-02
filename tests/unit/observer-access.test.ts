import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { ElectionStatus, UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../src/database/prisma";
import { hashToken } from "../../src/backend/auth/token-utils";

const TEST_OBS_ELECTION_NAME = "Observer Access Code Test Election";
let testElectionId: string;
let adminUserId: string;

before(async () => {
  // Ensure an admin user exists for createdBy relation
  let admin = await prisma.user.findFirst({ where: { role: UserRole.ADMIN } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        name: "Test Admin",
        email: "admin_test_obs@votechain.local",
        passwordHash: "dummy",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
  }
  adminUserId = admin.id;

  const election = await prisma.election.create({
    data: {
      name: TEST_OBS_ELECTION_NAME,
      startTime: new Date(),
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: ElectionStatus.ACTIVE,
      createdById: adminUserId,
    },
  });
  testElectionId = election.id;
});

after(async () => {
  if (testElectionId) {
    await prisma.election.deleteMany({ where: { id: testElectionId } });
  }
});

test("Observer Access: Code generation, hash verification, and regeneration lifecycle", async () => {
  const rawCode1 = "VC-OBS-7K9P-4M2X-8W3Y";
  const codeHash1 = hashToken(rawCode1);

  // 1. Assign observer access code hash to election
  await prisma.election.update({
    where: { id: testElectionId },
    data: { observerAccessCodeHash: codeHash1 },
  });

  const election = await prisma.election.findUnique({
    where: { id: testElectionId },
    select: { observerAccessCodeHash: true },
  });
  assert.equal(election?.observerAccessCodeHash, codeHash1);
  assert.notEqual(election?.observerAccessCodeHash, rawCode1, "Plaintext code must NEVER be stored in DB");

  // 2. Validate correct code succeeds
  const inputHashValid = hashToken("VC-OBS-7K9P-4M2X-8W3Y");
  assert.equal(inputHashValid, election?.observerAccessCodeHash);

  // 3. Validate incorrect code fails
  const inputHashInvalid = hashToken("VC-OBS-WRONG-CODE-0000");
  assert.notEqual(inputHashInvalid, election?.observerAccessCodeHash);

  // 4. Admin regenerates code: old code is immediately invalidated
  const rawCode2 = "VC-OBS-2B5C-9D1E-4F7A";
  const codeHash2 = hashToken(rawCode2);
  await prisma.election.update({
    where: { id: testElectionId },
    data: { observerAccessCodeHash: codeHash2 },
  });

  const updatedElection = await prisma.election.findUnique({
    where: { id: testElectionId },
    select: { observerAccessCodeHash: true },
  });
  assert.equal(updatedElection?.observerAccessCodeHash, codeHash2);
  assert.notEqual(hashToken(rawCode1), updatedElection?.observerAccessCodeHash, "Old code must now be invalid");

  // 5. Admin revokes code: observer access disabled
  await prisma.election.update({
    where: { id: testElectionId },
    data: { observerAccessCodeHash: null },
  });

  const revokedElection = await prisma.election.findUnique({
    where: { id: testElectionId },
    select: { observerAccessCodeHash: true },
  });
  assert.equal(revokedElection?.observerAccessCodeHash, null);
});
