import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { TokenType, UserRole, UserStatus } from "@prisma/client";
import { prisma } from "@/database/prisma";
import { generateSecureToken } from "@/backend/auth/token-utils";
import { sendPasswordResetEmail } from "@/backend/auth/email";

export const runtime = "nodejs";

// Simple in-memory rate limiter: max 5 requests per IP / email per hour
const rateLimitMap = new Map<string, { count: number; expiresAt: number }>();

function checkRateLimit(key: string, maxRequests = 5, windowMs = 3600000): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || record.expiresAt < now) {
    rateLimitMap.set(key, { count: 1, expiresAt: now + windowMs });
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count += 1;
  return true;
}

/**
 * POST /api/auth/forgot-password
 * Initiates password recovery.
 * Strictly non-enumerating: always returns the identical 200 response to prevent account harvesting.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const email = String((body as { email?: unknown }).email ?? "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown-ip";
  const rateLimitKey = `pwd-reset:${clientIp}:${email}`;

  if (!checkRateLimit(rateLimitKey)) {
    return NextResponse.json(
      { error: "Too many password reset requests. Please wait a while before trying again." },
      { status: 429 }
    );
  }

  // Non-enumerating success response returned uniformly
  const genericResponse = {
    ok: true,
    message: "If an account exists for this email address, a password reset link has been sent.",
  };

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    // Guard: only active users and non-admins can reset via web email flow
    // (Admin resets require direct CLI access via scripts/create-or-reset-admin.ts)
    if (!user || user.status !== UserStatus.ACTIVE || user.role === UserRole.ADMIN) {
      // Artificial delay to prevent timing discrepancy side-channels
      await new Promise((r) => setTimeout(r, 150));
      return NextResponse.json(genericResponse);
    }

    // Invalidate existing unused password reset tokens
    await prisma.verificationToken.updateMany({
      where: {
        userId: user.id,
        type: TokenType.PASSWORD_RESET,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    // Generate fresh 32-byte CSPRNG token (1 hour expiration)
    const { rawToken, tokenHash } = generateSecureToken();
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        type: TokenType.PASSWORD_RESET,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    // Send reset email via voter transporter
    await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      token: rawToken,
    });

    // Audit log (without raw token)
    await prisma.auditLog.create({
      data: {
        eventType: "PASSWORD_RESET_REQUESTED",
        actorReference: `user:${user.email}`,
        details: `Password reset link requested for account ${user.email}.`,
        eventHash: createHash("sha256").update(`${user.id}:RESET_REQ:${Date.now()}`).digest("hex"),
      },
    });

    return NextResponse.json(genericResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Password recovery failed.";
    console.error("[VoteChain Forgot Password Error]:", message);
    return NextResponse.json(genericResponse);
  }
}
