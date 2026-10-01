import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import {
  isValidPsgEmail,
  isValidStudentId,
  isValidPassword,
  isValidName,
  ALLOWED_EMAIL_DOMAIN,
} from "./auth-validation";
import {
  registerStudentVoter,
  verifyEmailToken,
  resendVerificationEmailByEmail,
  hashVerificationToken,
} from "./registration";
import {
  getSentEmailHistory,
  clearSentEmailHistory,
  VOTECHAIN_SENDER_EMAIL,
  getAppBaseUrl,
  sendVerificationEmail,
} from "./email";

const TEST_STUDENT_ID_1 = "24TEST01";
const TEST_EMAIL_1 = "24test01@psgtech.ac.in";
const TEST_PASSWORD_1 = "SecurePass123!";

const TEST_STUDENT_ID_2 = "24TEST02";
const TEST_EMAIL_2 = "24test02@psgtech.ac.in";

async function cleanupTestUsers() {
  const emails = [TEST_EMAIL_1, TEST_EMAIL_2, "expired_test@psgtech.ac.in", "resend_test@psgtech.ac.in"];
  const ids = [TEST_STUDENT_ID_1, TEST_STUDENT_ID_2, "EXP01", "RESEND01"];

  await prisma.verificationToken.deleteMany({
    where: { user: { OR: [{ email: { in: emails } }, { voterId: { in: ids } }] } },
  });
  await prisma.user.deleteMany({
    where: { OR: [{ email: { in: emails } }, { voterId: { in: ids } }] },
  });
}

before(async () => {
  await cleanupTestUsers();
  clearSentEmailHistory();
});

after(async () => {
  await cleanupTestUsers();
  clearSentEmailHistory();
  await prisma.$disconnect();
});

test("Phase 1: Valid registration creates unverified voter and token", async () => {
  clearSentEmailHistory();

  const result = await registerStudentVoter({
    name: "Test Student Alpha",
    studentId: TEST_STUDENT_ID_1,
    email: TEST_EMAIL_1,
    password: TEST_PASSWORD_1,
  });

  assert.equal(result.success, true);
  assert.equal(result.email, TEST_EMAIL_1);
  assert.equal(result.studentId, TEST_STUDENT_ID_1);
  assert.ok(result.token, "Must return a raw verification token");

  // Verify in database: user must exist and have emailVerified = false
  const user = await prisma.user.findUnique({
    where: { email: TEST_EMAIL_1 },
  });
  assert.ok(user, "User must be created in database");
  assert.equal(user.emailVerified, false, "User must initially be unverified");
  assert.equal(user.role, "VOTER");
  assert.equal(user.voterId, TEST_STUDENT_ID_1);

  // Verify token in database
  const tokenRecord = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashVerificationToken(result.token!) },
  });
  assert.ok(tokenRecord, "Token hash must exist in database");
  assert.equal(tokenRecord.userId, user.id);
  assert.equal(tokenRecord.usedAt, null, "Token must not be marked used yet");
  assert.ok(tokenRecord.expiresAt > new Date(), "Token expiry must be in future");
});

test("Phase 1: Invalid domain is rejected", async () => {
  // Unit check
  assert.equal(isValidPsgEmail("student@gmail.com"), false);
  assert.equal(isValidPsgEmail("student@yahoo.co.in"), false);
  assert.equal(isValidPsgEmail("student@psgtech.edu"), false);
  assert.equal(isValidPsgEmail(`student${ALLOWED_EMAIL_DOMAIN}`), true);

  // Registration attempt
  const result = await registerStudentVoter({
    name: "Invalid Domain User",
    studentId: "24INV01",
    email: "student@gmail.com",
    password: "Password123!",
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "INVALID_DOMAIN");
  assert.ok(result.error?.includes("@psgtech.ac.in"));
});

test("Phase 1: Duplicate email registration is blocked", async () => {
  const result = await registerStudentVoter({
    name: "Duplicate Email User",
    studentId: "24DIFF01",
    email: TEST_EMAIL_1, // already used
    password: "Password123!",
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "DUPLICATE_EMAIL");
});

test("Phase 1: Duplicate Student ID registration is blocked", async () => {
  const result = await registerStudentVoter({
    name: "Duplicate ID User",
    studentId: TEST_STUDENT_ID_1, // already used
    email: "different_email@psgtech.ac.in",
    password: "Password123!",
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "DUPLICATE_STUDENT_ID");
});

test("Phase 1: Email delivery records correct recipient and sender", async () => {
  const history = getSentEmailHistory();
  assert.ok(history.length > 0, "At least one email must have been sent");

  const latest = history[history.length - 1];
  assert.equal(latest.to, TEST_EMAIL_1);
  assert.ok(latest.verifyUrl.includes("/verify-email?token="));
  assert.equal(VOTECHAIN_SENDER_EMAIL, "votechain.verify@gmail.com");
});

test("Phase 1: Valid verification activates voter and marks token used", async () => {
  // Find user and token
  const userBefore = await prisma.user.findUniqueOrThrow({ where: { email: TEST_EMAIL_1 } });
  assert.equal(userBefore.emailVerified, false);

  const history = getSentEmailHistory();
  const token = history[0].token;

  const verifyResult = await verifyEmailToken(token);
  assert.equal(verifyResult.success, true);
  assert.equal(verifyResult.email, TEST_EMAIL_1);

  // User is now verified
  const userAfter = await prisma.user.findUniqueOrThrow({ where: { email: TEST_EMAIL_1 } });
  assert.equal(userAfter.emailVerified, true);

  // Token is marked used
  const tokenRecord = await prisma.verificationToken.findUniqueOrThrow({
    where: { tokenHash: hashVerificationToken(token) },
  });
  assert.ok(tokenRecord.usedAt !== null, "Token must be recorded as used");
});

test("Phase 1: Expired token is rejected", async () => {
  // Create user with expired token
  const expiredPasswordHash = await bcrypt.hash("ExpiredPass123!", 10);
  const expiredUser = await prisma.user.create({
    data: {
      name: "Expired Token Student",
      voterId: "EXP01",
      email: "expired_test@psgtech.ac.in",
      passwordHash: expiredPasswordHash,
      emailVerified: false,
    },
  });

  const rawExpiredToken = "expired_token_raw_1234567890abcdef";
  const tokenHash = hashVerificationToken(rawExpiredToken);

  await prisma.verificationToken.create({
    data: {
      userId: expiredUser.id,
      tokenHash,
      expiresAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour in the past
    },
  });

  const result = await verifyEmailToken(rawExpiredToken);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "TOKEN_EXPIRED");

  // User remains unverified
  const check = await prisma.user.findUniqueOrThrow({ where: { id: expiredUser.id } });
  assert.equal(check.emailVerified, false);
});

test("Phase 1: Reused token is rejected (single-use token)", async () => {
  const history = getSentEmailHistory();
  const alreadyUsedToken = history[0].token;

  // Attempt to use the already-verified token a second time
  const reuseResult = await verifyEmailToken(alreadyUsedToken);
  assert.equal(reuseResult.success, false);
  assert.equal(reuseResult.errorCode, "TOKEN_REUSED");
});

test("Phase 1: Resend verification creates new token and allows verification", async () => {
  // Register another student
  const regResult = await registerStudentVoter({
    name: "Resend Test Student",
    studentId: "RESEND01",
    email: "resend_test@psgtech.ac.in",
    password: "ResendPass123!",
  });
  assert.equal(regResult.success, true);

  const initialHistoryLen = getSentEmailHistory().length;

  // Request resend
  const resendResult = await resendVerificationEmailByEmail("resend_test@psgtech.ac.in");
  assert.equal(resendResult.success, true);

  const newHistory = getSentEmailHistory();
  assert.equal(newHistory.length, initialHistoryLen + 1);

  const newEmail = newHistory[newHistory.length - 1];
  assert.equal(newEmail.to, "resend_test@psgtech.ac.in");
  const newToken = newEmail.token;

  // The old token should now be invalidated/marked used
  const oldTokenHash = hashVerificationToken(regResult.token!);
  const oldTokenRecord = await prisma.verificationToken.findUniqueOrThrow({
    where: { tokenHash: oldTokenHash },
  });
  assert.ok(oldTokenRecord.usedAt !== null, "Old token must be invalidated");

  // The new token should verify successfully
  const verifyRes = await verifyEmailToken(newToken);
  assert.equal(verifyRes.success, true);

  const user = await prisma.user.findUniqueOrThrow({ where: { email: "resend_test@psgtech.ac.in" } });
  assert.equal(user.emailVerified, true);
});

test("Phase 1: Unverified voter login is blocked", async () => {
  // Register an unverified student
  await registerStudentVoter({
    name: "Unverified Student",
    studentId: TEST_STUDENT_ID_2,
    email: TEST_EMAIL_2,
    password: "ValidPassword123!",
  });

  const unverifiedUser = await prisma.user.findUniqueOrThrow({ where: { email: TEST_EMAIL_2 } });
  assert.equal(unverifiedUser.emailVerified, false);

  // Check login logic: password matches, but voter is unverified
  const passwordMatches = await bcrypt.compare("ValidPassword123!", unverifiedUser.passwordHash);
  assert.equal(passwordMatches, true);

  const isBlocked = unverifiedUser.role === "VOTER" && !unverifiedUser.emailVerified;
  assert.equal(isBlocked, true, "Unverified voter must be blocked from logging in");
});

test("Phase 1: Verified voter login is allowed", async () => {
  // TEST_EMAIL_1 was verified in an earlier test
  const verifiedUser = await prisma.user.findUniqueOrThrow({ where: { email: TEST_EMAIL_1 } });
  assert.equal(verifiedUser.emailVerified, true);

  const passwordMatches = await bcrypt.compare(TEST_PASSWORD_1, verifiedUser.passwordHash);
  assert.equal(passwordMatches, true);

  const isBlocked = verifiedUser.role === "VOTER" && !verifiedUser.emailVerified;
  assert.equal(isBlocked, false, "Verified voter must be allowed to sign in");
});

test("Phase 1: Wrong password is blocked", async () => {
  const verifiedUser = await prisma.user.findUniqueOrThrow({ where: { email: TEST_EMAIL_1 } });
  const wrongPasswordMatches = await bcrypt.compare("WrongPassword999!", verifiedUser.passwordHash);
  assert.equal(wrongPasswordMatches, false, "Wrong password must be rejected");
});

test("Phase 5: Email verification URL uses Vercel production URL rather than localhost", async () => {
  // Test 1: Explicit baseUrl passed (e.g. from request headers on Vercel)
  assert.equal(
    getAppBaseUrl("https://votechain.vercel.app"),
    "https://votechain.vercel.app"
  );

  // Test 2: VERCEL_PROJECT_PRODUCTION_URL environment variable
  const originalVercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  try {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "votechain.vercel.app";
    assert.equal(getAppBaseUrl(), "https://votechain.vercel.app");

    // Test 3: VERCEL_URL fallback
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    process.env.VERCEL_URL = "votechain-git-master.vercel.app";
    assert.equal(getAppBaseUrl(), "https://votechain-git-master.vercel.app");
  } finally {
    if (originalVercelProd !== undefined) {
      process.env.VERCEL_PROJECT_PRODUCTION_URL = originalVercelProd;
    } else {
      delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    }
    if (originalAppUrl !== undefined) {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    } else {
      delete process.env.NEXT_PUBLIC_APP_URL;
    }
  }

  // Test 4: Verification email generation with production URL
  const sendResult = await sendVerificationEmail({
    to: "verify_prod_test@psgtech.ac.in",
    name: "Production Test Student",
    studentId: "PROD01",
    token: "mock-prod-token-12345",
    baseUrl: "https://votechain.vercel.app",
  });
  assert.ok(sendResult.verifyUrl.startsWith("https://votechain.vercel.app/verify-email?token="));
  assert.ok(!sendResult.verifyUrl.includes("localhost"));
});

