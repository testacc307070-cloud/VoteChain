import { NextResponse } from "next/server";
import { TokenType, UserRole } from "@prisma/client";
import { prisma } from "@/database/prisma";
import { hashToken } from "@/backend/auth/token-utils";

export const runtime = "nodejs";

/**
 * GET or POST /api/authority/verify-token
 * Validates whether an authority invitation token is genuine, unexpired, and unused.
 * Returns the trustee's public details (name, email) without exposing token hashes.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token")?.trim() || "";
  return verifyToken(token);
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

  return verifyToken(token);
}

async function verifyToken(rawToken: string) {
  if (!rawToken || rawToken.length < 32) {
    return NextResponse.json(
      { valid: false, error: "Invalid invitation token parameter." },
      { status: 400 }
    );
  }

  const tokenHash = hashToken(rawToken);

  try {
    const tokenRecord = await prisma.verificationToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
          },
        },
      },
    });

    if (!tokenRecord) {
      return NextResponse.json(
        { valid: false, error: "Invitation token not found or invalid." },
        { status: 404 }
      );
    }

    if (tokenRecord.type !== TokenType.AUTHORITY_INVITATION) {
      return NextResponse.json(
        { valid: false, error: "Token purpose mismatch." },
        { status: 400 }
      );
    }

    if (tokenRecord.usedAt !== null) {
      return NextResponse.json(
        { valid: false, error: "This invitation link has already been used to activate an account." },
        { status: 410 }
      );
    }

    if (tokenRecord.expiresAt < new Date()) {
      return NextResponse.json(
        { valid: false, error: "This invitation link has expired. Please request a new invitation from the administrator." },
        { status: 410 }
      );
    }

    if (tokenRecord.user.role !== UserRole.AUTHORITY) {
      return NextResponse.json(
        { valid: false, error: "Account role is not eligible for authority trustee activation." },
        { status: 403 }
      );
    }

    return NextResponse.json({
      valid: true,
      user: {
        name: tokenRecord.user.name,
        email: tokenRecord.user.email,
        status: tokenRecord.user.status,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error validating invitation token.";
    return NextResponse.json({ valid: false, error: message }, { status: 500 });
  }
}
