import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "@/database/prisma";
import { requireAdminApi } from "@/backend/voting/admin-api";

export const runtime = "nodejs";

/**
 * GET /api/admin/authorities
 * Returns the list of configured election authorities/trustees with slot index (1, 2, 3).
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
      },
      orderBy: { createdAt: "asc" },
    });

    const items = authorities.map((a, index) => ({
      id: a.id,
      authorityIndex: index + 1, // Slot 1, 2, or 3
      name: a.name,
      email: a.email,
      role: a.role,
      status: a.status,
      createdAt: a.createdAt.toISOString(),
    }));

    return NextResponse.json({
      authorities: items,
      totalCount: items.length,
      maxAllowed: 3,
      canAddMore: items.length < 3,
    });
  } catch {
    return NextResponse.json({ error: "Could not retrieve authority list." }, { status: 500 });
  }
}

/**
 * POST /api/admin/authorities
 * Creates and invites a new authority trustee account.
 * Enforces maximum of 3 authorities for the 2-of-3 threshold custody system.
 * Enforces strict role isolation from voters.
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

  const { name, email, password } = body as {
    name?: unknown;
    email?: unknown;
    password?: unknown;
  };

  const cleanName = String(name ?? "").trim();
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  const rawPassword = String(password ?? "");

  if (!cleanName || cleanName.length < 2 || cleanName.length > 80) {
    return NextResponse.json({ error: "Full Name must be between 2 and 80 characters." }, { status: 400 });
  }

  if (!cleanEmail || !cleanEmail.includes("@") || cleanEmail.length > 254) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  if (!rawPassword || rawPassword.length < 8 || rawPassword.length > 128) {
    return NextResponse.json({ error: "Temporary password must be at least 8 characters long." }, { status: 400 });
  }

  try {
    // 1. Verify that fewer than 3 authorities currently exist
    const currentAuthorities = await prisma.user.findMany({
      where: { role: UserRole.AUTHORITY },
      orderBy: { createdAt: "asc" },
    });

    if (currentAuthorities.length >= 3) {
      return NextResponse.json(
        {
          error: "Maximum limit of 3 election authorities reached. VoteChain enforces exactly 3 trustees for 2-of-3 threshold custody.",
        },
        { status: 400 }
      );
    }

    // 2. Check for duplicate email across all accounts
    const existingUser = await prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email address already exists in the system." },
        { status: 409 }
      );
    }

    // 3. Ensure role isolation from voters: authority cannot be in any election eligibility list
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

    const assignedSlot = currentAuthorities.length + 1;
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

    // Record append-only audit event
    await prisma.auditLog.create({
      data: {
        eventType: "AUTHORITY_CREATED",
        actorReference: `admin:${auth.user.email}`,
        details: `Created Authority Trustee #${assignedSlot}: "${newAuthority.name}" (${newAuthority.email}).`,
        eventHash: createHash("sha256").update(`${newAuthority.id}:${assignedSlot}:${Date.now()}`).digest("hex"),
      },
    });

    return NextResponse.json(
      {
        ok: true,
        authority: {
          id: newAuthority.id,
          authorityIndex: assignedSlot,
          name: newAuthority.name,
          email: newAuthority.email,
          role: newAuthority.role,
          status: newAuthority.status,
          createdAt: newAuthority.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create authority account.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
