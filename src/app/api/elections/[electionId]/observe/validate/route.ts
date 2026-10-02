import { NextResponse } from "next/server";
import { prisma } from "@/database/prisma";
import { hashToken } from "@/backend/auth/token-utils";

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
 * POST /api/elections/[electionId]/observe/validate
 * Validates an election observer access code.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ electionId: string }> }
) {
  const { electionId } = await context.params;

  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown-ip";
  const rateLimitKey = `obs-rate:${clientIp}:${electionId}`;

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

  const code = typeof body === "object" && body !== null && "accessCode" in body
    ? String((body as { accessCode: unknown }).accessCode || "").trim().toUpperCase()
    : "";

  if (!code) {
    return NextResponse.json({ error: "Please enter an observer access code." }, { status: 400 });
  }

  try {
    const election = await prisma.election.findUnique({
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
        { error: "No observer access code has been activated for this election." },
        { status: 403 }
      );
    }

    const inputHash = hashToken(code);

    if (inputHash !== election.observerAccessCodeHash) {
      recordFailure(rateLimitKey);
      return NextResponse.json(
        { error: "Invalid access code for this election." },
        { status: 401 }
      );
    }

    recordSuccess(rateLimitKey);

    // Create a temporary scoped observer access proof token
    const sessionToken = hashToken(`${electionId}:${code}:${Math.floor(Date.now() / (1000 * 60 * 60))}`);

    return NextResponse.json({
      ok: true,
      electionId: election.id,
      electionName: election.name,
      sessionToken,
      message: `Observer access granted for election: ${election.name}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Validation error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
