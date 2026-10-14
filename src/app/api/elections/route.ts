import { NextResponse } from "next/server";
import { prisma } from "@/database/prisma";

export const runtime = "nodejs";

/**
 * GET /api/elections
 * Returns a public, safe summary of observable elections.
 * Strictly excludes voter identities, ballots, secret shares, and encryption keys.
 */
export async function GET() {
  try {
    const elections = await prisma.election.findMany({
      where: {
        status: { in: ["ACTIVE", "CLOSED", "RESULTS_PUBLISHED", "UPCOMING", "DRAFT"] },
      },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        startTime: true,
        endTime: true,
        resultsPublishedAt: true,
        _count: {
          select: {
            candidates: true,
            votes: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { startTime: "desc" }],
    });

    const safeElections = elections.map((e) => ({
      id: e.id,
      name: e.name.replace(/Phase\s+\d+\s*[-:]?\s*/gi, "").trim() || e.name,
      description: e.description,
      status: e.status,
      startTime: e.startTime.toISOString(),
      endTime: e.endTime.toISOString(),
      resultsPublishedAt: e.resultsPublishedAt?.toISOString() || null,
      candidatesCount: e._count.candidates,
      totalVotesCast: e._count.votes,
    }));

    return NextResponse.json({
      ok: true,
      elections: safeElections,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to load elections.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
