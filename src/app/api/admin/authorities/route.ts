import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { UserRole, UserStatus, TokenType } from "@prisma/client";
import { prisma } from "@/database/prisma";
import { requireAdminApi } from "@/backend/voting/admin-api";
import { generateSecureToken } from "@/backend/auth/token-utils";
import { sendAuthorityInvitationEmail } from "@/backend/auth/email";
import { isValidEmail, validatePasswordPolicy } from "@/backend/auth/auth-validation";

export const runtime = "nodejs";

/**
 * GET /api/admin/authorities
 * Returns the list of configured election authorities/trustees in the global pool.
 * Never exposes passwords or private key shares.
 */
export async function GET() {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  try {
    const authorities = await prisma.user.findMany({
      where: { role: UserRole.AUTHORITY },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        trusteeElections: {
          select: {
            electionId: true,
            slotIndex: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const items = authorities.map((a, index) => ({
      id: a.id,
      authorityIndex: index + 1,
      name: a.name,
      email: a.email,
      role: a.role,
      status: a.status,
      assignedElectionsCount: a.trusteeElections.length,
      createdAt: a.createdAt.toISOString(),
    }));

    return NextResponse.json({
      authorities: items,
      totalCount: items.length,
    });
  } catch {
    return NextResponse.json({ error: "Could not retrieve authority list." }, { status: 500 });
  }
}

/**
 * POST /api/admin/authorities
 * Supports both invitation-based creation (recommended) and direct provisioning.
 * Allows flexible institutional/personal email domains.
 * Enforces role isolation from voters.
 */
export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const { name, email, password, invite } = body as {
    name?: unknown;
    email?: unknown;
    password?: unknown;
    invite?: unknown;
  };

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host");
  const reqBaseUrl = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : host
    ? `${host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https"}://${host}`
    : undefined;

  const cleanName = String(name ?? "").trim();
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  const rawPassword = password ? String(password) : "";
  const isInviteFlow = invite === true || !rawPassword;

  if (!cleanName || cleanName.length < 2 || cleanName.length > 80) {
    return NextResponse.json({ error: "Full Name must be between 2 and 80 characters." }, { status: 400 });
  }

  if (!cleanEmail || !isValidEmail(cleanEmail)) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  try {
    // 1. Check for duplicate email across all accounts
    const existingUser = await prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email address already exists in the system." },
        { status: 409 }
      );
    }

    // 2. Ensure role isolation from voters: authority cannot be in any election eligibility list
    const registeredVoter = await prisma.electionEligibleVoter.findFirst({
      where: { email: cleanEmail },
    });

    if (registeredVoter) {
      return NextResponse.json(
        {
          error: "This email is registered in an election voter eligibility list. Authority accounts must be strictly isolated from voter roles.",
        },
        { status: 400 }
      );
    }

    if (isInviteFlow) {
      // INVITATION FLOW: Create user with INVITED status and send setup email
      const randomPasswordMarker = await bcrypt.hash(Date.now().toString() + Math.random().toString(), 12);
      const newAuthority = await prisma.user.create({
        data: {
          name: cleanName,
          email: cleanEmail,
          passwordHash: randomPasswordMarker,
          role: UserRole.AUTHORITY,
          status: UserStatus.INVITED,
          emailVerified: false,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
        },
      });

      // Generate 256-bit CSPRNG token and store SHA-256 hash
      const { rawToken, tokenHash } = generateSecureToken();
      await prisma.verificationToken.create({
        data: {
          userId: newAuthority.id,
          tokenHash,
          type: TokenType.AUTHORITY_INVITATION,
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48-hour expiration
        },
      });

      // Send invitation email via admin mailer
      const emailResult = await sendAuthorityInvitationEmail({
        to: newAuthority.email,
        name: newAuthority.name,
        token: rawToken,
        baseUrl: reqBaseUrl,
      });

      // Record append-only audit event (zero raw tokens in logs)
      await prisma.auditLog.create({
        data: {
          eventType: "AUTHORITY_INVITED",
          actorReference: `admin:${auth.user.email}`,
          details: `Invited Authority Trustee: "${newAuthority.name}" (${newAuthority.email}).`,
          eventHash: createHash("sha256").update(`${newAuthority.id}:INVITED:${Date.now()}`).digest("hex"),
        },
      });

      return NextResponse.json(
        {
          ok: true,
          invited: true,
          authority: {
            id: newAuthority.id,
            name: newAuthority.name,
            email: newAuthority.email,
            role: newAuthority.role,
            status: newAuthority.status,
            createdAt: newAuthority.createdAt.toISOString(),
          },
          emailDelivery: {
            sent: emailResult.success,
            error: emailResult.error,
          },
        },
        { status: 201 }
      );
    } else {
      // DIRECT PROVISIONING (with explicit password)
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

      const passwordHash = await bcrypt.hash(rawPassword, 12);
      const newAuthority = await prisma.user.create({
        data: {
          name: cleanName,
          email: cleanEmail,
          passwordHash,
          role: UserRole.AUTHORITY,
          status: UserStatus.ACTIVE,
          emailVerified: true,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
        },
      });

      await prisma.auditLog.create({
        data: {
          eventType: "AUTHORITY_CREATED",
          actorReference: `admin:${auth.user.email}`,
          details: `Directly created Authority Trustee: "${newAuthority.name}" (${newAuthority.email}).`,
          eventHash: createHash("sha256").update(`${newAuthority.id}:CREATED:${Date.now()}`).digest("hex"),
        },
      });

      return NextResponse.json(
        {
          ok: true,
          invited: false,
          authority: {
            id: newAuthority.id,
            name: newAuthority.name,
            email: newAuthority.email,
            role: newAuthority.role,
            status: newAuthority.status,
            createdAt: newAuthority.createdAt.toISOString(),
          },
        },
        { status: 201 }
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not process authority creation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
