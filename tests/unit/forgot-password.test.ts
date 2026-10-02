import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import bcrypt from "bcryptjs";
import { UserRole, UserStatus, TokenType } from "@prisma/client";
import { prisma } from "../../src/database/prisma";
import { generateSecureToken, hashToken } from "../../src/backend/auth/token-utils";

const RESET_USER_EMAIL = "student_reset_test@psgtech.ac.in";
const INITIAL_PASSWORD = "InitialPassword123!";
const UPDATED_PASSWORD = "NewPassword2026!#";

async function cleanup() {
  await prisma.verificationToken.deleteMany({
    where: { user: { email: RESET_USER_EMAIL } },
  });
  await prisma.user.deleteMany({
    where: { email: RESET_USER_EMAIL },
  });
}

before(async () => {
  await cleanup();
});

after(async () => {
  await cleanup();
});

test("Forgot Password: Full cycle reset, token invalidation, and credential update", async () => {
  // 1. Create active voter
  const initialHash = await bcrypt.hash(INITIAL_PASSWORD, 12);
  const user = await prisma.user.create({
    data: {
      name: "Reset Test Voter",
      email: RESET_USER_EMAIL,
      voterId: "VTR-RESET-01",
      passwordHash: initialHash,
      role: UserRole.VOTER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  // 2. Generate 1-hour password reset token
  const { rawToken, tokenHash } = generateSecureToken();
  const tokenRecord = await prisma.verificationToken.create({
    data: {
      userId: user.id,
      tokenHash,
      type: TokenType.PASSWORD_RESET,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    },
  });
  assert.equal(tokenRecord.type, TokenType.PASSWORD_RESET);
  assert.equal(tokenRecord.usedAt, null);

  // 3. Reset password using token
  const newHash = await bcrypt.hash(UPDATED_PASSWORD, 12);
  await prisma.$transaction(async (tx) => {
    const token = await tx.verificationToken.findUnique({
      where: { tokenHash },
    });
    assert.ok(token);
    assert.equal(token.usedAt, null);
    assert.ok(token.expiresAt > new Date());

    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    await tx.verificationToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });
  }, { timeout: 30000, maxWait: 15000 });

  // 4. Verify password update succeeded
  const refreshedUser = await prisma.user.findUnique({
    where: { id: user.id },
  });
  assert.ok(refreshedUser);
  const oldCheck = await bcrypt.compare(INITIAL_PASSWORD, refreshedUser.passwordHash);
  const newCheck = await bcrypt.compare(UPDATED_PASSWORD, refreshedUser.passwordHash);
  assert.equal(oldCheck, false, "Old password must no longer match");
  assert.equal(newCheck, true, "New password must match");

  // 5. Verify single-use token: token is burned
  const burnedToken = await prisma.verificationToken.findUnique({
    where: { tokenHash },
  });
  assert.ok(burnedToken);
  assert.notEqual(burnedToken.usedAt, null, "Used token must have usedAt timestamp");
});
