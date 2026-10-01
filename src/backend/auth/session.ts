import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { UserRole } from "@prisma/client";
import { prisma } from "@/database/prisma";

const COOKIE_NAME = "votechain_session";
const SESSION_SECONDS = 60 * 60 * 8;

type SessionPayload = { userId: string; expiresAt: number };

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return secret;
}

function sign(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

export function createSessionToken(userId: string) {
  const payload = Buffer.from(JSON.stringify({ userId, expiresAt: Date.now() + SESSION_SECONDS * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readSessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [payload, signature, ...extra] = token.split(".");
  if (!payload || !signature || extra.length) return null;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    if (typeof session.userId !== "string" || typeof session.expiresAt !== "number" || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, createSessionToken(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const session = readSessionToken(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return null;
  return prisma.user.findFirst({
    where: { id: session.userId, status: "ACTIVE" },
    select: { id: true, name: true, email: true, role: true, voterId: true, emailVerified: true },
  });
}

export function isAdminRole(role: UserRole) {
  return role === UserRole.ADMIN;
}