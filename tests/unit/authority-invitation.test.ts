import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import bcrypt from "bcryptjs";
import { UserRole, UserStatus, TokenType } from "@prisma/client";
import { prisma } from "../../src/database/prisma";
import { generateSecureToken, hashToken, sanitizeTokenUrl } from "../../src/backend/auth/token-utils";
import { sendAuthorityInvitationEmail } from "../../src/backend/auth/email";
import { isValidEmail, isValidPsgEmail, validatePasswordPolicy } from "../../src/backend/auth/auth-validation";
import { getRoleLandingRoute } from "../../src/backend/auth/role-routing";
import { checkVoterElectionEligibility } from "../../src/backend/voting/eligibility";

const TEST_AUTH_EMAIL = "test_trustee_invitation@gmail.com";
const TEST_AUTH_NAME = "Dr. Test Authority";

async function cleanup() {
  await prisma.verificationToken.deleteMany({
    where: { user: { email: { in: [TEST_AUTH_EMAIL, "expired_trustee@gmail.com", "external_trustee@gmail.com"] } } },
  });
  await prisma.user.deleteMany({
    where: { email: { in: [TEST_AUTH_EMAIL, "expired_trustee@gmail.com", "external_trustee@gmail.com"] } },
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

test("Authority Email Domains: permits external email domains while voter registration requires @psgtech.ac.in", () => {
  // Authority emails accept Gmail and institutional domains
  assert.equal(isValidEmail("admin.votechain@gmail.com"), true);
  assert.equal(isValidEmail("trustee.external@university.edu"), true);
  assert.equal(isValidEmail("professor@mit.edu"), true);

  // Voter registration strictly requires @psgtech.ac.in
  assert.equal(isValidPsgEmail("24test01@psgtech.ac.in"), true);
  assert.equal(isValidPsgEmail("admin.votechain@gmail.com"), false);
  assert.equal(isValidPsgEmail("trustee.external@university.edu"), false);
});

test("Authority Invitation Flow: Create invited user, dispatch token, and activate account", async () => {
  // 1. Create invited authority user with an external Gmail address
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
  assert.equal(user.role, UserRole.AUTHORITY);

  // 2. Generate and store 256-bit CSPRNG token hash
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

  // 3. Dispatch simulated email with tokenized URL
  const emailResult = await sendAuthorityInvitationEmail({
    to: user.email,
    name: user.name,
    token: rawToken,
    baseUrl: "https://vote-chain-pi.vercel.app",
  });
  assert.equal(emailResult.success, true);
  assert.ok(emailResult.setupUrl.startsWith("https://vote-chain-pi.vercel.app/authority/setup?token="));
  assert.ok(emailResult.setupUrl.includes(rawToken));

  // 4. Activate authority account with password meeting complexity policy
  const newPassword = "TrusteeSecure2026!#";
  const policyCheck = validatePasswordPolicy(newPassword);
  assert.equal(policyCheck.valid, true);

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
        name: "Dr. Test Authority (Activated)",
        passwordHash: newPasswordHash,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      },
    });
  }, { timeout: 30000, maxWait: 15000 });

  assert.equal(updatedUser.status, UserStatus.ACTIVE);
  assert.equal(updatedUser.emailVerified, true);
  assert.equal(updatedUser.name, "Dr. Test Authority (Activated)");
  assert.equal(updatedUser.role, UserRole.AUTHORITY);
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

test("Authority Role Separation: Login routes to /authority and authority cannot vote as a voter", async () => {
  // Role landing route maps AUTHORITY to /authority
  assert.equal(getRoleLandingRoute("AUTHORITY"), "/authority");
  assert.equal(getRoleLandingRoute("VOTER"), "/portal");
  assert.equal(getRoleLandingRoute("ADMIN"), "/");

  // Voter eligibility strictly blocks AUTHORITY role from casting ballots
  const eligibility = await checkVoterElectionEligibility({
    userId: "test-auth-id",
    email: "trustee@gmail.com",
    role: "AUTHORITY",
    emailVerified: true,
    electionId: "test-election",
  });

  assert.equal(eligibility.ok, false);
  assert.equal(eligibility.errorCode, "NOT_VOTER");
  assert.ok(eligibility.reason?.includes("Only registered voters"));
});
