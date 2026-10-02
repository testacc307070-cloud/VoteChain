import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { requireAdminApi } from "@/backend/voting/admin-api";
import { prisma } from "@/database/prisma";
import { hashToken } from "@/backend/auth/token-utils";

export const runtime = "nodejs";

function generateObserverCode(): string {
  // Generate 12 alphanumeric characters (excluding ambiguous chars: 0, O, I, 1)
  const charset = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(12);
  let codeChars = "";
  for (let i = 0; i < 12; i++) {
    codeChars += charset[bytes[i] % charset.length];
  }
  return `VC-OBS-${codeChars.slice(0, 4)}-${codeChars.slice(4, 8)}-${codeChars.slice(8, 12)}`;
}

/**
 * POST /api/elections/[electionId]/observer-code
 * Admin generates or regenerates an election-scoped observer access code.
 * Plaintext code is returned once to admin and NEVER stored in plaintext or logged.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ electionId: string }> }
) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  const { electionId } = await context.params;

  try {
    const election = await prisma.election.findUnique({
      where: { id: electionId },
      select: { id: true, name: true, observerAccessCodeHash: true },
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found." }, { status: 404 });
    }

    const rawCode = generateObserverCode();
    const codeHash = hashToken(rawCode);

    await prisma.election.update({
      where: { id: electionId },
      data: {
        observerAccessCodeHash: codeHash,
      },
    });

    const isRegeneration = Boolean(election.observerAccessCodeHash);

    // Audit log (without raw code)
    await prisma.auditLog.create({
      data: {
        eventType: isRegeneration ? "OBSERVER_CODE_REGENERATED" : "OBSERVER_CODE_GENERATED",
        actorReference: `admin:${auth.user.email}`,
        electionId,
        details: isRegeneration
          ? `Observer access code regenerated for election "${election.name}". Previous codes invalidated.`
          : `Observer access code generated for election "${election.name}".`,
        eventHash: createHash("sha256").update(`${electionId}:OBS_CODE:${Date.now()}`).digest("hex"),
      },
    });

    return NextResponse.json({
      ok: true,
      electionId,
      electionName: election.name,
      accessCode: rawCode, // Returned ONCE to the administrator
      isRegenerated: isRegeneration,
      message: "Observer access code successfully created. Share this code with authorized observers for this election.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate observer code.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/elections/[electionId]/observer-code
 * Admin revokes observer access code for this election.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ electionId: string }> }
) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  const { electionId } = await context.params;

  try {
    const election = await prisma.election.findUnique({
      where: { id: electionId },
      select: { id: true, name: true },
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found." }, { status: 404 });
    }

    await prisma.election.update({
      where: { id: electionId },
      data: {
        observerAccessCodeHash: null,
      },
    });

    await prisma.auditLog.create({
      data: {
        eventType: "OBSERVER_CODE_REVOKED",
        actorReference: `admin:${auth.user.email}`,
        electionId,
        details: `Observer access revoked for election "${election.name}".`,
        eventHash: createHash("sha256").update(`${electionId}:OBS_REVOKE:${Date.now()}`).digest("hex"),
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Observer access code successfully revoked.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not revoke observer code.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
