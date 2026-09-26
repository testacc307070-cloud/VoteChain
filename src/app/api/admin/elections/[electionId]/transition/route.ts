import { NextResponse } from "next/server";
import { ElectionStatus } from "@prisma/client";
import { requireAdminApi } from "@/lib/admin-api";
import { prisma } from "@/lib/prisma";
import { evaluateAuthorityThreshold } from "@/lib/authority";

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
      include: { _count: { select: { candidates: true } } },
    });
    if (!election) return NextResponse.json({ error: "Election not found." }, { status: 404 });

    const now = new Date();
    let nextStatus: ElectionStatus;
    let extraData: { candidatesLocked?: boolean; resultsPublishedAt?: Date } = {};
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
      const approvals = authorityApprovals.map((approval) => ({
        authorityId: approval.authorityId,
        approved: approval.approved,
      }));
      const approvalResult = evaluateAuthorityThreshold(approvals, 3);
      if (!approvalResult.approved) {
        return NextResponse.json({
          error: `Results publication requires ${approvalResult.required} authority approvals. Current approval count: ${approvalResult.approvals}.`,
        }, { status: 409 });
      }
      nextStatus = ElectionStatus.RESULTS_PUBLISHED;
      extraData = { resultsPublishedAt: now };
    }

    const updated = await prisma.election.update({
      where: { id: election.id },
      data: { status: nextStatus, ...extraData },
    });
    return NextResponse.json({ election: updated });
  } catch {
    return NextResponse.json({ error: "Could not change the election status." }, { status: 500 });
  }
}