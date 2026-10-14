import { NextResponse } from "next/server";
import { prisma } from "@/database/prisma";
import { hashToken } from "@/backend/auth/token-utils";
import { createObserverSessionToken } from "@/backend/auth/observer-token";

export const runtime = "nodejs";

const failedAttemptsMap = new Map<string, { count: number; lockedUntil: number }>();

function checkObserverRateLimit(ipKey: string): { allowed: boolean; remainingMs?: number } {
  const now = Date.now();
  const entry = failedAttemptsMap.get(ipKey);

  if (entry && entry.lockedUntil > now) {
    return { allowed: false, remainingMs: entry.lockedUntil - now };
  }

  return { allowed: true };
}

function recordFailure(ipKey: string) {
  const now = Date.now();
  const entry = failedAttemptsMap.get(ipKey);

  if (!entry || entry.lockedUntil <= now) {
    failedAttemptsMap.set(ipKey, { count: 1, lockedUntil: 0 });
    return;
  }

  entry.count += 1;
  if (entry.count >= 5) {
    // Lock out for 15 minutes after 5 failed attempts
    entry.lockedUntil = now + 15 * 60 * 1000;
  }
}

function recordSuccess(ipKey: string) {
  failedAttemptsMap.delete(ipKey);
}

/**
 * POST /api/observe/validate
 * Validates an observer access code.
 * If electionId is provided, validates for that election.
 * If not provided, automatically resolves the matching election.
 */
export async function POST(request: Request) {
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown-ip";
  const rateLimitKey = `obs-rate-global:${clientIp}`;

  const rateCheck = checkObserverRateLimit(rateLimitKey);
  if (!rateCheck.allowed) {
    const mins = Math.ceil((rateCheck.remainingMs || 0) / 60000);
    return NextResponse.json(
      { error: `Too many incorrect access code attempts. Access temporarily locked for ${mins} minutes.` },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 });
  }

  const code =
    typeof body === "object" && body !== null && "accessCode" in body
      ? String((body as { accessCode: unknown }).accessCode || "").trim().toUpperCase()
      : "";

  const electionId =
    typeof body === "object" && body !== null && "electionId" in body
      ? String((body as { electionId: unknown }).electionId || "").trim()
      : "";

  if (!code) {
    return NextResponse.json({ error: "Please enter an observer access code." }, { status: 400 });
  }

  try {
    const inputHash = hashToken(code);

    let election = null;
    if (electionId) {
      election = await prisma.election.findUnique({
        where: { id: electionId },
        select: {
          id: true,
          name: true,
          status: true,
          observerAccessCodeHash: true,
        },
      });

      if (!election) {
        return NextResponse.json({ error: "Election not found." }, { status: 404 });
      }

      if (!election.observerAccessCodeHash) {
        return NextResponse.json(
          { error: "Observer access for this election has been revoked or was not activated." },
          { status: 403 }
        );
      }

      if (election.observerAccessCodeHash !== inputHash) {
        recordFailure(rateLimitKey);
        return NextResponse.json(
          { error: "Invalid observer access code for this election." },
          { status: 401 }
        );
      }
    } else {
      // Automatic election resolution by code hash
      election = await prisma.election.findFirst({
        where: { observerAccessCodeHash: inputHash },
        select: {
          id: true,
          name: true,
          status: true,
          observerAccessCodeHash: true,
        },
      });

      if (!election) {
        recordFailure(rateLimitKey);
        return NextResponse.json(
          { error: "Invalid or revoked observer access code. Please verify the code with the administrator." },
          { status: 401 }
        );
      }
    }

    if (!election.observerAccessCodeHash) {
      return NextResponse.json(
        { error: "Observer access for this election has been revoked or was not activated." },
        { status: 403 }
      );
    }

    recordSuccess(rateLimitKey);

    const sessionToken = createObserverSessionToken(election.id, election.observerAccessCodeHash);

    return NextResponse.json({
      ok: true,
      electionId: election.id,
      electionName: election.name.replace(/Phase\s+\d+\s*[-:]?\s*/gi, "").trim() || election.name,
      sessionToken,
      message: `Observer access granted for election: ${election.name}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Validation error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
