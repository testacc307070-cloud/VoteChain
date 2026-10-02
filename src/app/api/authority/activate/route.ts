import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { TokenType, UserRole, UserStatus } from "@prisma/client";
import { prisma } from "@/database/prisma";
import { hashToken } from "@/backend/auth/token-utils";
import { validatePasswordPolicy } from "@/backend/auth/auth-validation";

export const runtime = "nodejs";

/**
 * POST /api/authority/activate
 * Sets the secret password for an invited authority trustee, marks the invitation token burned,
 * and activates the user account.
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
    return NextResponse.json({ error: "A valid invitation token is required." }, { status: 400 });
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

    // Atomic transaction: verify token, update user, burn token, log audit
    const result = await prisma.$transaction(async (tx) => {
      const tokenRecord = await tx.verificationToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });

      if (!tokenRecord) {
        throw new Error("TOKEN_NOT_FOUND");
      }

      if (tokenRecord.type !== TokenType.AUTHORITY_INVITATION) {
        throw new Error("TOKEN_TYPE_MISMATCH");
      }

      if (tokenRecord.usedAt !== null) {
        throw new Error("TOKEN_REUSED");
      }

      if (tokenRecord.expiresAt < new Date()) {
        throw new Error("TOKEN_EXPIRED");
      }

      if (tokenRecord.user.role !== UserRole.AUTHORITY) {
        throw new Error("ROLE_MISMATCH");
      }

      // 1. Update user credentials and status
      const updatedUser = await tx.user.update({
        where: { id: tokenRecord.userId },
        data: {
          passwordHash,
          status: UserStatus.ACTIVE,
          emailVerified: true,
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
          eventType: "AUTHORITY_ACTIVATED",
          actorReference: `authority:${updatedUser.email}`,
          details: `Authority Trustee "${updatedUser.name}" successfully activated account credentials.`,
          eventHash: createHash("sha256").update(`${updatedUser.id}:ACTIVATED:${Date.now()}`).digest("hex"),
        },
      });

      return updatedUser;
    });

    return NextResponse.json({
      ok: true,
      message: "Authority trustee account successfully activated. You can now log in.",
      user: {
        email: result.email,
        name: result.name,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Activation failed.";
    if (message === "TOKEN_NOT_FOUND") {
      return NextResponse.json({ error: "Invalid invitation token." }, { status: 404 });
    }
    if (message === "TOKEN_REUSED") {
      return NextResponse.json({ error: "This invitation token has already been used." }, { status: 410 });
    }
    if (message === "TOKEN_EXPIRED") {
      return NextResponse.json({ error: "This invitation token has expired." }, { status: 410 });
    }
    if (message === "ROLE_MISMATCH" || message === "TOKEN_TYPE_MISMATCH") {
      return NextResponse.json({ error: "Token is not valid for authority activation." }, { status: 403 });
    }

    return NextResponse.json({ error: "Could not activate authority account." }, { status: 500 });
  }
}
