import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/session";
import { getRoleLandingRoute } from "@/lib/role-routing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("email" in body) || !("password" in body)) {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }
  const { email, password } = body as { email: unknown; password: unknown };
  if (typeof email !== "string" || typeof password !== "string" || email.length > 254 || password.length > 1024) {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || user.status !== "ACTIVE" || !(await bcrypt.compare(password, user.passwordHash))) {
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }

  // Phase 1 requirement: Block unverified voters from signing in
  if (user.role === "VOTER" && !user.emailVerified) {
    return NextResponse.json(
      {
        error: "Your email address has not been verified yet. Please check your PSG Tech inbox for the verification link.",
        emailUnverified: true,
        email: user.email,
      },
      { status: 403 }
    );
  }

  await setSessionCookie(user.id);
  return NextResponse.json({ role: user.role, redirectTo: getRoleLandingRoute(user.role) });
}