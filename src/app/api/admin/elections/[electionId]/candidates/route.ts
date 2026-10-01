import { NextResponse } from "next/server";
import { ElectionStatus } from "@prisma/client";
import { requireAdminApi } from "@/backend/voting/admin-api";
import { parseCandidateInput } from "@/backend/voting/election-validation";
import { prisma } from "@/database/prisma";

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
  const parsed = parseCandidateInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const election = await prisma.election.findUnique({ where: { id: electionId } });
    if (!election) return NextResponse.json({ error: "Election not found." }, { status: 404 });
    if (election.status !== ElectionStatus.DRAFT || election.candidatesLocked) {
      return NextResponse.json({ error: "Candidates can be changed only while the election is a draft." }, { status: 409 });
    }

    const count = await prisma.electionCandidate.count({ where: { electionId } });
    if (count >= 20) return NextResponse.json({ error: "An election can have at most 20 candidates." }, { status: 409 });
    const duplicate = await prisma.electionCandidate.findFirst({
      where: { electionId, name: { equals: parsed.data.name, mode: "insensitive" } },
    });
    if (duplicate) return NextResponse.json({ error: "Candidate names must be unique within an election." }, { status: 409 });
    const order = await prisma.electionCandidate.aggregate({ where: { electionId }, _max: { sortOrder: true } });
    const candidate = await prisma.electionCandidate.create({
      data: { ...parsed.data, electionId, sortOrder: (order._max.sortOrder ?? -1) + 1 },
    });
    return NextResponse.json({ candidate }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not add the candidate." }, { status: 500 });
  }
}