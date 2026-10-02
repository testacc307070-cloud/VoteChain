import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/database/prisma";
import { requireAdminApi } from "@/backend/voting/admin-api";

export const runtime = "nodejs";

/**
 * GET /api/admin/elections/[electionId]
 * Retrieves details for a specific election.
 */
export async function GET(
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
        candidates: { orderBy: { sortOrder: "asc" } },
        _count: {
          select: {
            votes: true,
            participations: true,
            eligibleVoters: true,
            authorityApprovals: true,
            blocks: true,
          },
        },
      },
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found." }, { status: 404 });
    }

    const { encryptedMasterKey, ...safeElection } = election;

    return NextResponse.json({
      election: {
        ...safeElection,
        hasMasterKey: Boolean(encryptedMasterKey),
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not retrieve election." }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/elections/[electionId]
 * Deletes an unvoted election from the system.
 * Disallows deleting elections that have cast votes to preserve the cryptographic audit trail.
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
      include: {
        _count: {
          select: {
            votes: true,
            participations: true,
          },
        },
      },
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found." }, { status: 404 });
    }

    // Safety check: Disallow deleting elections with recorded votes to preserve the cryptographic audit trail
    if (election._count.votes > 0 || election._count.participations > 0) {
      return NextResponse.json(
        {
          error:
            "Cannot delete election with cast votes. To preserve the cryptographic audit trail and blockchain commitments, close the election instead.",
        },
        { status: 400 }
      );
    }

    // Unvoted election: safe cascading deletion in transaction
    await prisma.$transaction(
      async (tx) => {
        await tx.electionAuthorityApproval.deleteMany({ where: { electionId } });
        await tx.electionEligibleVoter.deleteMany({ where: { electionId } });
        await tx.electionBlockchainBlock.deleteMany({ where: { electionId } });
        await tx.electionCandidate.deleteMany({ where: { electionId } });
        await tx.election.delete({ where: { id: electionId } });

        await tx.auditLog.create({
          data: {
            eventType: "ELECTION_DELETED",
            actorReference: `admin:${auth.user.email}`,
            electionId: null,
            details: `Election "${election.name}" (ID: ${election.id}) with 0 votes was deleted by administrator.`,
            eventHash: createHash("sha256")
              .update(`${election.id}:DELETED:${Date.now()}`)
              .digest("hex"),
          },
        });
      },
      { timeout: 15000, maxWait: 10000 }
    );

    return NextResponse.json({
      ok: true,
      message: `Election "${election.name}" was successfully deleted.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete election.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
