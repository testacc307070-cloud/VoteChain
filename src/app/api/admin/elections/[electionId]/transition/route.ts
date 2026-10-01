import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { ElectionStatus } from "@prisma/client";
import { requireAdminApi } from "@/backend/voting/admin-api";
import { prisma } from "@/database/prisma";
import { evaluateAuthorityThreshold } from "@/security/threshold";
import { buildElectionIntegritySnapshot } from "@/verification/merkle";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ electionId: string }> }) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  const { electionId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || !("action" in body)) {
    return NextResponse.json({ error: "Provide a lifecycle action." }, { status: 400 });
  }
  const action = (body as { action: unknown }).action;
  if (action !== "lock" && action !== "activate" && action !== "close" && action !== "publish") {
    return NextResponse.json({ error: "Unknown lifecycle action." }, { status: 400 });
  }

  const authorityApprovals = await prisma.electionAuthorityApproval.findMany({
    where: { electionId },
  });

  try {
    const election = await prisma.election.findUnique({
      where: { id: electionId },
      include: {
        _count: { select: { candidates: true, votes: true } },
        blocks: { orderBy: { index: "asc" } },
      },
    });
    if (!election) return NextResponse.json({ error: "Election not found." }, { status: 404 });

    const now = new Date();
    let nextStatus: ElectionStatus;
    let extraData: { candidatesLocked?: boolean; resultsPublishedAt?: Date; merkleRoot?: string; resultsDigest?: string } = {};

    if (action === "lock") {
      if (election.status !== ElectionStatus.DRAFT || election.candidatesLocked) {
        return NextResponse.json({ error: "Only a draft election can be locked." }, { status: 409 });
      }
      if (election._count.candidates < 2) {
        return NextResponse.json({ error: "At least two candidates are required before locking." }, { status: 400 });
      }
      if (now >= election.endTime) {
        return NextResponse.json({ error: "The election end time has already passed." }, { status: 409 });
      }
      nextStatus = ElectionStatus.UPCOMING;
      extraData = { candidatesLocked: true };
    } else if (action === "activate") {
      if (election.status !== ElectionStatus.UPCOMING) {
        return NextResponse.json({ error: "Only an upcoming election can be activated." }, { status: 409 });
      }
      if (now < election.startTime || now >= election.endTime) {
        return NextResponse.json({ error: "Activation is allowed only during the configured election window." }, { status: 409 });
      }
      nextStatus = ElectionStatus.ACTIVE;
    } else if (action === "close") {
      if (election.status !== ElectionStatus.ACTIVE) {
        return NextResponse.json({ error: "Only an active election can be closed." }, { status: 409 });
      }
      if (now < election.endTime) {
        return NextResponse.json({ error: "The configured election end time has not been reached." }, { status: 409 });
      }
      nextStatus = ElectionStatus.CLOSED;
    } else {
      if (election.status !== ElectionStatus.CLOSED) {
        return NextResponse.json({ error: "Results can be published only after an election closes." }, { status: 409 });
      }
      const required = election.requiredAuthorityApprovals ?? 2;
      const approvals = authorityApprovals.map((approval) => ({
        authorityId: approval.authorityId,
        approved: approval.approved,
        keyShare: approval.keyShare,
      }));
      const approvalResult = evaluateAuthorityThreshold(approvals, required);
      if (!approvalResult.approved) {
        return NextResponse.json({
          error: `Results publication requires ${approvalResult.required} authority approvals. Current approval count: ${approvalResult.approvals}.`,
        }, { status: 409 });
      }

      const integrity = buildElectionIntegritySnapshot({
        electionId: election.id,
        totalVotes: election._count.votes,
        validVotes: election._count.votes,
        invalidVotes: 0,
        blockHeight: election.blocks.length,
      });

      nextStatus = ElectionStatus.RESULTS_PUBLISHED;
      extraData = {
        resultsPublishedAt: now,
        merkleRoot: integrity.merkleRoot,
        resultsDigest: `sha256:${election.id}:${now.toISOString()}`,
      };
    }

    const updated = await prisma.election.update({
      where: { id: election.id },
      data: { status: nextStatus, ...extraData },
    });

    // Record append-only audit event
    await prisma.auditLog.create({
      data: {
        eventType: `ELECTION_STATUS_${nextStatus}`,
        actorReference: `admin:${auth.user.email}`,
        electionId: election.id,
        details: `Election "${election.name}" transitioned to ${nextStatus}. Action: ${action}.`,
        eventHash: createHash("sha256").update(`${election.id}:${nextStatus}:${now.toISOString()}`).digest("hex"),
      },
    });

    return NextResponse.json({ election: updated });
  } catch {
    return NextResponse.json({ error: "Could not change the election status." }, { status: 500 });
  }
}