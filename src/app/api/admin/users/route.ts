import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/admin-api";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        voterId: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        _count: {
          select: { participations: true },
        },
      },
      orderBy: [{ role: "asc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({ users });
  } catch {
    return NextResponse.json({ error: "Could not retrieve user register." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  try {
    const body = (await request.json()) as {
      name?: unknown;
      email?: unknown;
      voterId?: unknown;
      password?: unknown;
      role?: unknown;
    };

    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const voterId = body.voterId ? String(body.voterId).trim() : null;
    const password = String(body.password ?? "");
    const rawRole = String(body.role ?? "VOTER").toUpperCase();

    if (!name || name.length < 2) {
      return NextResponse.json({ error: "Name must be at least 2 characters." }, { status: 400 });
    }
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }

    const role = (Object.values(UserRole) as string[]).includes(rawRole)
      ? (rawRole as UserRole)
      : UserRole.VOTER;

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email },
          ...(voterId ? [{ voterId }] : []),
        ],
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "A user with this email or voter ID is already registered." },
        { status: 409 },
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        voterId,
        passwordHash,
        role,
        status: UserStatus.ACTIVE,
      },
      select: {
        id: true,
        voterId: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    // Record audit event
    await prisma.auditLog.create({
      data: {
        eventType: role === UserRole.VOTER ? "VOTER_REGISTERED" : "USER_REGISTERED",
        actorReference: `admin:${auth.user.email}`,
        details: `Registered ${role.toLowerCase()} "${newUser.name}" (${newUser.email}${newUser.voterId ? `, ID: ${newUser.voterId}` : ""}).`,
        eventHash: createHash("sha256").update(`${newUser.id}:${newUser.email}:${Date.now()}`).digest("hex"),
      },
    });

    return NextResponse.json({ ok: true, user: newUser }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not register user.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
