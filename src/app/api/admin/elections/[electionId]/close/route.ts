import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { ElectionStatus } from "@prisma/client";
import { requireAdminApi } from "@/backend/voting/admin-api";
import { prisma } from "@/database/prisma";

export const runtime = "nodejs";

/**
 * POST /api/admin/elections/[electionId]/close
 * Dedicated action endpoint to close an active election immediately.
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
      include: {
        _count: { select: { votes: true } },
      },
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found." }, { status: 404 });
    }

    if (election.status !== ElectionStatus.ACTIVE) {
      return NextResponse.json(
        { error: `Cannot close election: current status is ${election.status}. Only ACTIVE elections can be closed.` },
        { status: 409 }
      );
    }

    const now = new Date();
    const updated = await prisma.election.update({
      where: { id: electionId },
      data: {
        status: ElectionStatus.CLOSED,
        ...(now < election.endTime ? { endTime: now } : {}),
      },
    });

    await prisma.auditLog.create({
      data: {
        eventType: "ELECTION_CLOSED_EARLY",
        actorReference: `admin:${auth.user.email}`,
        electionId: election.id,
        details: `Election "${election.name}" closed early by administrator. Preserved ${election._count.votes} votes.`,
        eventHash: createHash("sha256")
          .update(`${election.id}:CLOSED_EARLY:${now.toISOString()}`)
          .digest("hex"),
      },
    });

    return NextResponse.json({
      ok: true,
      message: `Election "${election.name}" has been closed. Voting is now halted.`,
      election: updated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not close the election.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
