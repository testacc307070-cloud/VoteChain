import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { UserRole, UserStatus, TokenType } from "@prisma/client";
import { prisma } from "@/database/prisma";
import { requireAdminApi } from "@/backend/voting/admin-api";
import { generateSecureToken } from "@/backend/auth/token-utils";
import { sendAuthorityInvitationEmail } from "@/backend/auth/email";

export const runtime = "nodejs";

/**
 * POST /api/admin/authorities/[authorityId]/resend
 * Invalidates any existing unused invitation tokens and generates a fresh 48-hour invitation.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ authorityId: string }> }
) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  const { authorityId } = await context.params;

  try {
    const authorityUser = await prisma.user.findUnique({
      where: { id: authorityId },
      select: { id: true, name: true, email: true, role: true, status: true },
    });

    if (!authorityUser || authorityUser.role !== UserRole.AUTHORITY) {
      return NextResponse.json({ error: "Authority account not found." }, { status: 404 });
    }

    if (authorityUser.status !== UserStatus.INVITED) {
      return NextResponse.json(
        { error: `Cannot resend invitation for authority with status ${authorityUser.status}. Only INVITED authorities can be resent.` },
        { status: 400 }
      );
    }

    // Invalidate existing unused invitation tokens
    await prisma.verificationToken.updateMany({
      where: {
        userId: authorityUser.id,
        type: TokenType.AUTHORITY_INVITATION,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    // Generate new 256-bit CSPRNG token
    const { rawToken, tokenHash } = generateSecureToken();
    await prisma.verificationToken.create({
      data: {
        userId: authorityUser.id,
        tokenHash,
        type: TokenType.AUTHORITY_INVITATION,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });

    // Dispatch fresh email
    const emailResult = await sendAuthorityInvitationEmail({
      to: authorityUser.email,
      name: authorityUser.name,
      token: rawToken,
    });

    await prisma.auditLog.create({
      data: {
        eventType: "AUTHORITY_INVITATION_RESENT",
        actorReference: `admin:${auth.user.email}`,
        details: `Resent invitation to Authority Trustee: "${authorityUser.name}" (${authorityUser.email}).`,
        eventHash: createHash("sha256").update(`${authorityUser.id}:RESENT:${Date.now()}`).digest("hex"),
      },
    });

    return NextResponse.json({
      ok: true,
      message: `Invitation successfully resent to ${authorityUser.email}.`,
      emailSent: emailResult.success,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not resend invitation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
