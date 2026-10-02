import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { TokenType } from "@prisma/client";
import { prisma } from "@/database/prisma";
import { hashToken } from "@/backend/auth/token-utils";
import { validatePasswordPolicy } from "@/backend/auth/auth-validation";

export const runtime = "nodejs";

/**
 * POST /api/auth/reset-password
 * Updates the user's password using a valid password reset token, and burns the token.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request payload." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const { token, password } = body as { token?: unknown; password?: unknown };
  const rawToken = String(token ?? "").trim();
  const rawPassword = String(password ?? "");

  if (!rawToken || rawToken.length < 32) {
    return NextResponse.json({ error: "A valid reset token is required." }, { status: 400 });
  }

  const policyCheck = validatePasswordPolicy(rawPassword);
  if (!policyCheck.valid) {
    return NextResponse.json(
      {
        error: policyCheck.reason || "Password does not meet complexity requirements.",
        errors: policyCheck.errors,
      },
      { status: 400 }
    );
  }

  const tokenHash = hashToken(rawToken);

  try {
    const passwordHash = await bcrypt.hash(rawPassword, 12);

    await prisma.$transaction(async (tx) => {
      const tokenRecord = await tx.verificationToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });

      if (!tokenRecord) {
        throw new Error("TOKEN_NOT_FOUND");
      }

      if (tokenRecord.type !== TokenType.PASSWORD_RESET) {
        throw new Error("TOKEN_TYPE_MISMATCH");
      }

      if (tokenRecord.usedAt !== null) {
        throw new Error("TOKEN_REUSED");
      }

      if (tokenRecord.expiresAt < new Date()) {
        throw new Error("TOKEN_EXPIRED");
      }

      // 1. Update user password
      await tx.user.update({
        where: { id: tokenRecord.userId },
        data: {
          passwordHash,
        },
      });

      // 2. Mark token used (atomic single-use burning)
      await tx.verificationToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: new Date() },
      });

      // 3. Record audit event
      await tx.auditLog.create({
        data: {
          eventType: "PASSWORD_RESET_COMPLETED",
          actorReference: `user:${tokenRecord.user.email}`,
          details: `Password reset successfully completed for account ${tokenRecord.user.email}.`,
          eventHash: createHash("sha256").update(`${tokenRecord.userId}:RESET_DONE:${Date.now()}`).digest("hex"),
        },
      });
    });

    return NextResponse.json({
      ok: true,
      message: "Password successfully updated. You can now sign in with your new password.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reset failed.";
    if (message === "TOKEN_NOT_FOUND") {
      return NextResponse.json({ error: "Invalid password reset token." }, { status: 404 });
    }
    if (message === "TOKEN_REUSED") {
      return NextResponse.json({ error: "This password reset token has already been used." }, { status: 410 });
    }
    if (message === "TOKEN_EXPIRED") {
      return NextResponse.json({ error: "This password reset token has expired." }, { status: 410 });
    }
    return NextResponse.json({ error: "Could not reset password." }, { status: 500 });
  }
}
