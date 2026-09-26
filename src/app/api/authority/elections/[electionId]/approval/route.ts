import { NextResponse } from "next/server";
import { ElectionStatus } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

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

  await prisma.electionAuthorityApproval.upsert({
    where: {
      electionId_authorityId: {
        electionId,
        authorityId: user.id,
      },
    },
    update: { approved },
    create: {
      electionId,
      authorityId: user.id,
      approved,
    },
  });

  return NextResponse.redirect(new URL("/authority", request.url));
}