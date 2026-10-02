import { NextResponse } from "next/server";
import { TokenType } from "@prisma/client";
import { prisma } from "@/database/prisma";
import { hashToken } from "@/backend/auth/token-utils";

export const runtime = "nodejs";

/**
 * GET or POST /api/auth/verify-reset-token
 * Validates whether a password reset token is active, unexpired, and unused.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token")?.trim() || "";
  return verifyResetToken(token);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 });
  }

  const token = typeof body === "object" && body !== null && "token" in body
    ? String((body as { token: unknown }).token || "").trim()
    : "";

  return verifyResetToken(token);
}

async function verifyResetToken(rawToken: string) {
  if (!rawToken || rawToken.length < 32) {
    return NextResponse.json({ valid: false, error: "Invalid reset token parameter." }, { status: 400 });
  }

  const tokenHash = hashToken(rawToken);

  try {
    const tokenRecord = await prisma.verificationToken.findUnique({
      where: { tokenHash },
      include: {
        user: { select: { email: true, name: true } },
      },
    });

    if (!tokenRecord) {
      return NextResponse.json({ valid: false, error: "Password reset link not found or invalid." }, { status: 404 });
    }

    if (tokenRecord.type !== TokenType.PASSWORD_RESET) {
      return NextResponse.json({ valid: false, error: "Token purpose mismatch." }, { status: 400 });
    }

    if (tokenRecord.usedAt !== null) {
      return NextResponse.json({ valid: false, error: "This password reset link has already been used." }, { status: 410 });
    }

    if (tokenRecord.expiresAt < new Date()) {
      return NextResponse.json({ valid: false, error: "This password reset link has expired. Please request a new one." }, { status: 410 });
    }

    return NextResponse.json({
      valid: true,
      email: tokenRecord.user.email,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error validating reset token.";
    return NextResponse.json({ valid: false, error: message }, { status: 500 });
  }
}
