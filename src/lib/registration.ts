import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  isValidPsgEmail,
  isValidStudentId,
  isValidName,
  isValidPassword,
  normalizeEmail,
  normalizeStudentId,
  ALLOWED_EMAIL_DOMAIN,
} from "@/lib/auth-validation";
import { sendVerificationEmail } from "@/lib/email";

export const TOKEN_EXPIRY_HOURS = 24;

export interface RegisterVoterInput {
  name: string;
  studentId: string;
  email: string;
  password: string;
  baseUrl?: string;
}

export interface RegisterVoterResult {
  success: boolean;
  userId?: string;
  email?: string;
  studentId?: string;
  token?: string;
  verifyUrl?: string;
  error?: string;
  errorCode?: "INVALID_DOMAIN" | "DUPLICATE_EMAIL" | "DUPLICATE_STUDENT_ID" | "INVALID_INPUT" | "INTERNAL_ERROR";
}

export interface VerifyTokenResult {
  success: boolean;
  email?: string;
  error?: string;
  errorCode?: "INVALID_TOKEN" | "TOKEN_EXPIRED" | "TOKEN_REUSED" | "INTERNAL_ERROR";
}

export interface ResendVerificationResult {
  success: boolean;
  message?: string;
  error?: string;
  errorCode?: "USER_NOT_FOUND" | "ALREADY_VERIFIED" | "INVALID_INPUT" | "INTERNAL_ERROR";
}

export function hashVerificationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateVerificationToken(): {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashVerificationToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
  return { rawToken, tokenHash, expiresAt };
}

export async function registerStudentVoter(input: RegisterVoterInput): Promise<RegisterVoterResult> {
  const { name, studentId, email, password } = input;

  // 1. Validate name
  const nameCheck = isValidName(name);
  if (!nameCheck.valid) {
    return { success: false, error: nameCheck.reason || "Invalid name.", errorCode: "INVALID_INPUT" };
  }

  // 2. Validate Student ID
  if (!isValidStudentId(studentId)) {
    return {
      success: false,
      error: "Student ID must be 3-30 alphanumeric characters (e.g., 24N236).",
      errorCode: "INVALID_INPUT",
    };
  }

  // 3. Validate @psgtech.ac.in institutional email
  if (!isValidPsgEmail(email)) {
    return {
      success: false,
      error: `Registration requires an official institutional email ending with ${ALLOWED_EMAIL_DOMAIN}.`,
      errorCode: "INVALID_DOMAIN",
    };
  }

  // 4. Validate password strength
  const passCheck = isValidPassword(password);
  if (!passCheck.valid) {
    return { success: false, error: passCheck.reason || "Invalid password.", errorCode: "INVALID_INPUT" };
  }

  const cleanName = name.trim();
  const cleanEmail = normalizeEmail(email);
  const cleanStudentId = normalizeStudentId(studentId);

  // 5. Check duplicate email
  const existingEmailUser = await prisma.user.findUnique({
    where: { email: cleanEmail },
  });
  if (existingEmailUser) {
    return {
      success: false,
      error: "An account with this email address is already registered.",
      errorCode: "DUPLICATE_EMAIL",
    };
  }

  // 6. Check duplicate student ID
  const existingIdUser = await prisma.user.findUnique({
    where: { voterId: cleanStudentId },
  });
  if (existingIdUser) {
    return {
      success: false,
      error: "An account with this Student ID is already registered.",
      errorCode: "DUPLICATE_STUDENT_ID",
    };
  }

  // 7. Hash password
  const passwordHash = await bcrypt.hash(password, 12);

  // 8. Generate verification token
  const { rawToken, tokenHash, expiresAt } = generateVerificationToken();

  try {
    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: cleanName,
          email: cleanEmail,
          voterId: cleanStudentId,
          passwordHash,
          role: UserRole.VOTER,
          status: UserStatus.ACTIVE,
          emailVerified: false,
        },
      });

      await tx.verificationToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      await tx.auditLog.create({
        data: {
          eventType: "USER_REGISTERED",
          actorReference: `student:${cleanStudentId}`,
          details: `Student registered: ${cleanName} (${cleanEmail}, ID: ${cleanStudentId}) - Pending verification.`,
          eventHash: createHash("sha256").update(`${user.id}:${cleanEmail}:${Date.now()}`).digest("hex"),
        },
      });

      return user;
    }, { maxWait: 15000, timeout: 20000 });

    // 9. Send verification email via Gmail SMTP
    const emailResult = await sendVerificationEmail({
      to: cleanEmail,
      name: cleanName,
      studentId: cleanStudentId,
      token: rawToken,
      baseUrl: input.baseUrl,
    });

    return {
      success: true,
      userId: newUser.id,
      email: cleanEmail,
      studentId: cleanStudentId,
      token: rawToken,
      verifyUrl: emailResult.verifyUrl,
    };
  } catch (error) {
    console.error("Registration database error:", error);
    return {
      success: false,
      error: "An unexpected error occurred during registration. Please try again.",
      errorCode: "INTERNAL_ERROR",
    };
  }
}

export async function verifyEmailToken(rawToken: string): Promise<VerifyTokenResult> {
  if (typeof rawToken !== "string" || !rawToken.trim()) {
    return { success: false, error: "Verification token is required.", errorCode: "INVALID_TOKEN" };
  }

  const tokenHash = hashVerificationToken(rawToken.trim());

  const tokenRecord = await prisma.verificationToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!tokenRecord) {
    return { success: false, error: "Invalid verification token.", errorCode: "INVALID_TOKEN" };
  }

  if (tokenRecord.usedAt !== null) {
    return {
      success: false,
      error: "This verification link has already been used. Please log in or request a new one.",
      errorCode: "TOKEN_REUSED",
    };
  }

  if (tokenRecord.expiresAt < new Date()) {
    return {
      success: false,
      error: "This verification link has expired. Please request a new verification email.",
      errorCode: "TOKEN_EXPIRED",
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Mark token as used
      await tx.verificationToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: new Date() },
      });

      // Update user as verified
      await tx.user.update({
        where: { id: tokenRecord.userId },
        data: { emailVerified: true },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          eventType: "EMAIL_VERIFIED",
          actorReference: `user:${tokenRecord.userId}`,
          details: `Email verified successfully for ${tokenRecord.user.email} (Student ID: ${tokenRecord.user.voterId || "N/A"}).`,
          eventHash: createHash("sha256").update(`${tokenRecord.id}:${tokenRecord.userId}:${Date.now()}`).digest("hex"),
        },
      });
    }, { maxWait: 15000, timeout: 20000 });

    return { success: true, email: tokenRecord.user.email };
  } catch (error) {
    console.error("Token verification database error:", error);
    return {
      success: false,
      error: "Unable to complete email verification due to a system error.",
      errorCode: "INTERNAL_ERROR",
    };
  }
}

export async function resendVerificationEmailByEmail(rawEmail: string, baseUrl?: string): Promise<ResendVerificationResult> {
  if (!isValidPsgEmail(rawEmail)) {
    return {
      success: false,
      error: `Please enter a valid official institutional email ending with ${ALLOWED_EMAIL_DOMAIN}.`,
      errorCode: "INVALID_INPUT",
    };
  }

  const email = normalizeEmail(rawEmail);
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    return {
      success: false,
      error: "No account found registered with this email address.",
      errorCode: "USER_NOT_FOUND",
    };
  }

  if (user.emailVerified) {
    return {
      success: false,
      error: "This email address is already verified. You can sign in directly.",
      errorCode: "ALREADY_VERIFIED",
    };
  }

  // Generate new token
  const { rawToken, tokenHash, expiresAt } = generateVerificationToken();

  try {
    await prisma.$transaction(async (tx) => {
      // Expire or mark used any previous unused tokens
      await tx.verificationToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      // Create new active token
      await tx.verificationToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      await tx.auditLog.create({
        data: {
          eventType: "VERIFICATION_RESENT",
          actorReference: `user:${user.id}`,
          details: `Verification email resent to ${user.email}.`,
          eventHash: createHash("sha256").update(`${user.id}:${tokenHash}:${Date.now()}`).digest("hex"),
        },
      });
    }, { maxWait: 15000, timeout: 20000 });

    await sendVerificationEmail({
      to: user.email,
      name: user.name,
      studentId: user.voterId || "STUDENT",
      token: rawToken,
      baseUrl,
    });

    return {
      success: true,
      message: "A new verification link has been sent to your PSG Tech email.",
    };
  } catch (error) {
    console.error("Resend verification error:", error);
    return {
      success: false,
      error: "Could not resend verification email due to a system error.",
      errorCode: "INTERNAL_ERROR",
    };
  }
}
