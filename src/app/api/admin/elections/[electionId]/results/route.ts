import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/admin-api";
import { createElectionAuditDigest, summarizeElectionResults } from "@/lib/election-results";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ electionId: string }> }) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  const { electionId } = await context.params;

  try {
    const election = await prisma.election.findUnique({
      where: { id: electionId },
      include: {
        candidates: { orderBy: { sortOrder: "asc" } },
        votes: {
          select: { candidateId: true },
        },
      },
    });

    if (!election) return NextResponse.json({ error: "Election not found." }, { status: 404 });
    if (election.status !== "CLOSED" && election.status !== "RESULTS_PUBLISHED") {
      return NextResponse.json({ error: "Results are available only after the election closes." }, { status: 409 });
    }

    const summary = summarizeElectionResults(
      election.candidates.map((candidate) => ({ id: candidate.id, name: candidate.name })),
      election.votes,
    );

    const auditDigest = createElectionAuditDigest({
      electionId: election.id,
      totalVotes: summary.totalVotes,
      candidateResults: summary.candidateResults,
      publishedAt: election.resultsPublishedAt ?? new Date(),
    });

    return NextResponse.json({
      election: {
        id: election.id,
        name: election.name,
        status: election.status,
        resultsPublishedAt: election.resultsPublishedAt,
      },
      summary,
      auditDigest,
    });
  } catch {
    return NextResponse.json({ error: "Could not compile election results." }, { status: 500 });
  }
}
