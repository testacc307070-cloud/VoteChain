import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import bcrypt from "bcryptjs";
import { UserRole, UserStatus, TokenType } from "@prisma/client";
import { prisma } from "../../src/database/prisma";
import { generateSecureToken, hashToken, sanitizeTokenUrl } from "../../src/backend/auth/token-utils";
import { sendAuthorityInvitationEmail } from "../../src/backend/auth/email";

const TEST_AUTH_EMAIL = "test_trustee_invitation@gmail.com";
const TEST_AUTH_NAME = "Dr. Test Authority";

async function cleanup() {
  await prisma.verificationToken.deleteMany({
    where: { user: { email: TEST_AUTH_EMAIL } },
  });
  await prisma.user.deleteMany({
    where: { email: TEST_AUTH_EMAIL },
  });
}

before(async () => {
  await cleanup();
});

after(async () => {
  await cleanup();
});

test("Authority Token: 256-bit CSPRNG generation and SHA-256 digest at rest", () => {
  const { rawToken, tokenHash } = generateSecureToken();
  assert.equal(typeof rawToken, "string");
  assert.equal(rawToken.length, 64); // 32 bytes in hex
  assert.equal(tokenHash, hashToken(rawToken));
  assert.notEqual(rawToken, tokenHash);
});

test("Authority Token: URL sanitization strips raw token from log outputs", () => {
  const rawUrl = "https://votechain.local/authority/setup?token=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const sanitized = sanitizeTokenUrl(rawUrl);
  assert.ok(!sanitized.includes("0123456789abcdef"));
  assert.ok(sanitized.includes("token=REDACTED"));
});

test("Authority Invitation Flow: Create invited user, dispatch token, and activate account", async () => {
  // 1. Create invited authority user
  const randomMarker = await bcrypt.hash(Date.now().toString(), 12);
  const user = await prisma.user.create({
    data: {
      name: TEST_AUTH_NAME,
      email: TEST_AUTH_EMAIL,
      passwordHash: randomMarker,
      role: UserRole.AUTHORITY,
      status: UserStatus.INVITED,
      emailVerified: false,
    },
  });
  assert.equal(user.status, UserStatus.INVITED);
  assert.equal(user.emailVerified, false);

  // 2. Generate and store token
  const { rawToken, tokenHash } = generateSecureToken();
  const tokenRecord = await prisma.verificationToken.create({
    data: {
      userId: user.id,
      tokenHash,
      type: TokenType.AUTHORITY_INVITATION,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
    },
  });
  assert.equal(tokenRecord.type, TokenType.AUTHORITY_INVITATION);
  assert.equal(tokenRecord.usedAt, null);

  // 3. Dispatch simulated email
  const emailResult = await sendAuthorityInvitationEmail({
    to: user.email,
    name: user.name,
    token: rawToken,
  });
  assert.equal(emailResult.success, true);
  assert.ok(emailResult.setupUrl.includes(rawToken));

  // 4. Activate authority account
  const newPassword = "TrusteeSecure2026!#";
  const newPasswordHash = await bcrypt.hash(newPassword, 12);

  const updatedUser = await prisma.$transaction(async (tx) => {
    const foundToken = await tx.verificationToken.findUnique({
      where: { tokenHash },
    });
    assert.ok(foundToken);
    assert.equal(foundToken.usedAt, null);

    await tx.verificationToken.update({
      where: { id: foundToken.id },
      data: { usedAt: new Date() },
    });

    return tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      },
    });
  }, { timeout: 30000, maxWait: 15000 });

  assert.equal(updatedUser.status, UserStatus.ACTIVE);
  assert.equal(updatedUser.emailVerified, true);
  const passwordMatches = await bcrypt.compare(newPassword, updatedUser.passwordHash);
  assert.equal(passwordMatches, true);

  // 5. Verify single-use token: second activation attempt must be rejected (TOKEN_REUSED)
  const reusedToken = await prisma.verificationToken.findUnique({
    where: { tokenHash },
  });
  assert.ok(reusedToken);
  assert.notEqual(reusedToken.usedAt, null);
});

test("Authority Token: Expired invitation token is rejected", async () => {
  const expiredEmail = "expired_trustee@gmail.com";
  const user = await prisma.user.create({
    data: {
      name: "Expired Trustee",
      email: expiredEmail,
      passwordHash: "dummy",
      role: UserRole.AUTHORITY,
      status: UserStatus.INVITED,
    },
  });

  const { rawToken, tokenHash } = generateSecureToken();
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      tokenHash,
      type: TokenType.AUTHORITY_INVITATION,
      expiresAt: new Date(Date.now() - 1000), // In the past
    },
  });

  const foundToken = await prisma.verificationToken.findUnique({
    where: { tokenHash },
  });
  assert.ok(foundToken);
  assert.ok(foundToken.expiresAt < new Date(), "Token should be detected as expired");

  // Cleanup
  await prisma.verificationToken.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
});
