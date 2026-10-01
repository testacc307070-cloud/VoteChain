import { NextResponse } from "next/server";
import { ElectionStatus } from "@prisma/client";
import { requireAdminApi } from "@/backend/voting/admin-api";
import { parseCandidateInput } from "@/backend/voting/election-validation";
import { prisma } from "@/database/prisma";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ electionId: string; candidateId: string }> }) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;
  const { electionId, candidateId } = await context.params;

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
    const candidate = await prisma.electionCandidate.findFirst({ where: { id: candidateId, electionId } });
    if (!candidate) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    const duplicate = await prisma.electionCandidate.findFirst({
      where: { electionId, id: { not: candidateId }, name: { equals: parsed.data.name, mode: "insensitive" } },
    });
    if (duplicate) return NextResponse.json({ error: "Candidate names must be unique within an election." }, { status: 409 });

    const updated = await prisma.electionCandidate.update({ where: { id: candidateId }, data: parsed.data });
    return NextResponse.json({ candidate: updated });
  } catch {
    return NextResponse.json({ error: "Could not update the candidate." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ electionId: string; candidateId: string }> }) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;
  const { electionId, candidateId } = await context.params;

  try {
    const election = await prisma.election.findUnique({ where: { id: electionId } });
    if (!election) return NextResponse.json({ error: "Election not found." }, { status: 404 });
    if (election.status !== ElectionStatus.DRAFT || election.candidatesLocked) {
      return NextResponse.json({ error: "Candidates can be changed only while the election is a draft." }, { status: 409 });
    }
    const candidate = await prisma.electionCandidate.findFirst({ where: { id: candidateId, electionId } });
    if (!candidate) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    const count = await prisma.electionCandidate.count({ where: { electionId } });
    if (count <= 2) return NextResponse.json({ error: "Keep at least two candidates in the election." }, { status: 409 });

    await prisma.electionCandidate.delete({ where: { id: candidate.id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Could not remove the candidate." }, { status: 500 });
  }
}