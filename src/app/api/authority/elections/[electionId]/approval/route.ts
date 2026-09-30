import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { ElectionStatus } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { splitElectionSecret } from "@/lib/authority";
import { getElectionEncryptionKey } from "@/lib/election-keys";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ electionId: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (user.role !== "AUTHORITY") {
    return NextResponse.json({ error: "Authority access required." }, { status: 403 });
  }

  const { electionId } = await context.params;

  let approved = false;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await request.json();
      approved = Boolean((body as { approved?: unknown })?.approved === true || (body as { approved?: unknown })?.approved === "true");
    } else {
      const form = await request.formData();
      const rawApproved = String(form.get("approved") ?? "false");
      approved = rawApproved === "true" || rawApproved === "1" || rawApproved.toLowerCase() === "yes";
    }
  } catch {
    return NextResponse.json({ error: "Approval payload is required." }, { status: 400 });
  }

  const election = await prisma.election.findUnique({ where: { id: electionId } });
  if (!election) {
    return NextResponse.json({ error: "Election not found." }, { status: 404 });
  }

  if (election.status !== ElectionStatus.CLOSED && election.status !== ElectionStatus.RESULTS_PUBLISHED) {
    return NextResponse.json({ error: "Authority approval is only available for closed elections." }, { status: 409 });
  }

  const existingApproval = await prisma.electionAuthorityApproval.findUnique({
    where: {
      electionId_authorityId: {
        electionId,
        authorityId: user.id,
      },
    },
  });

  let keyShare = existingApproval?.keyShare ?? null;
  if (approved && !keyShare) {
    const masterKey = getElectionEncryptionKey(election, { purpose: "authority_share_generation" });
    const authorities = await prisma.user.findMany({
      where: { role: "AUTHORITY" },
      orderBy: { createdAt: "asc" },
    });
    const authIndex = authorities.findIndex((a) => a.id === user.id);
    if (authIndex < 0) {
      return NextResponse.json({ error: "You are not a designated authority for this election." }, { status: 403 });
    }
    const total = Math.max(authorities.length, 3);
    const threshold = election.requiredAuthorityApprovals || 2;
    const shares = splitElectionSecret(election.id, masterKey, total, threshold);
    keyShare = shares[authIndex % total];
  }

  const updatedApproval = await prisma.electionAuthorityApproval.upsert({
    where: {
      electionId_authorityId: {
        electionId,
        authorityId: user.id,
      },
    },
    update: {
      approved,
      ...(keyShare ? { keyShare } : {}),
    },
    create: {
      electionId,
      authorityId: user.id,
      approved,
      keyShare,
    },
  });

  // Record append-only audit event (without exposing secret share)
  await prisma.auditLog.create({
    data: {
      eventType: approved ? "AUTHORITY_APPROVAL_GRANTED" : "AUTHORITY_REVIEW_FLAGGED",
      actorReference: `authority:${user.email}`,
      electionId,
      details: approved
        ? `Authority ${user.name} approved results and submitted key share.`
        : `Authority ${user.name} flagged election for review.`,
      eventHash: createHash("sha256").update(`${electionId}:${user.id}:${approved}:${Date.now()}`).digest("hex"),
    },
  });

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return NextResponse.json({
      ok: true,
      approval: {
        id: updatedApproval.id,
        electionId: updatedApproval.electionId,
        authorityId: updatedApproval.authorityId,
        approved: updatedApproval.approved,
        hasKeyShare: Boolean(updatedApproval.keyShare),
        updatedAt: updatedApproval.updatedAt,
      },
    });
  }

  return NextResponse.redirect(new URL("/authority", request.url));
}