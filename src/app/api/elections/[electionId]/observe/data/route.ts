import { NextResponse } from "next/server";
import { prisma } from "@/database/prisma";
import { buildBlockchainSummary } from "@/blockchain/blockchain";
import { buildElectionIntegritySnapshot } from "@/verification/merkle";

export const runtime = "nodejs";

/**
 * GET /api/elections/[electionId]/observe/data
 * Returns read-only observation data for the authorized election.
 * Strips all voter identities, private keys, DEKs, and Shamir shares.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ electionId: string }> }
) {
  const { electionId } = await context.params;

  try {
    const election = await prisma.election.findUnique({
      where: { id: electionId },
      include: {
        candidates: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            name: true,
            description: true,
            sortOrder: true,
            _count: { select: { votes: true } },
          },
        },
        blocks: {
          orderBy: { index: "asc" },
          select: {
            id: true,
            index: true,
            previousHash: true,
            hash: true,
            timestamp: true,
          },
        },
        _count: {
          select: {
            votes: true,
            eligibleVoters: true,
          },
        },
      },
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found." }, { status: 404 });
    }

    const auditLogs = await prisma.auditLog.findMany({
      where: { electionId },
      take: 20,
      orderBy: { timestamp: "desc" },
      select: {
        id: true,
        eventType: true,
        actorReference: true,
        details: true,
        timestamp: true,
        eventHash: true,
      },
    });

    const isResultsPublished = election.status === "RESULTS_PUBLISHED";

    const candidates = election.candidates.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      sortOrder: c.sortOrder,
      voteCount: isResultsPublished ? c._count.votes : null,
    }));

    const blockchainSummary = buildBlockchainSummary(
      election.blocks.map((b) => ({
        index: b.index,
        previousHash: b.previousHash,
        hash: b.hash,
        payload: "",
        timestamp: b.timestamp.getTime(),
      }))
    );

    const integrity = buildElectionIntegritySnapshot({
      electionId: election.id,
      totalVotes: election._count.votes,
      validVotes: election._count.votes,
      invalidVotes: 0,
      blockHeight: election.blocks.length,
    });

    return NextResponse.json({
      election: {
        id: election.id,
        name: election.name,
        description: election.description,
        status: election.status,
        startTime: election.startTime.toISOString(),
        endTime: election.endTime.toISOString(),
        resultsPublishedAt: election.resultsPublishedAt?.toISOString() || null,
        totalVotesCast: election._count.votes,
        totalEligibleVoters: election._count.eligibleVoters,
        merkleRoot: election.merkleRoot || integrity.merkleRoot,
        candidates,
        blockchain: {
          blockCount: election.blocks.length,
          blocks: election.blocks,
          summary: blockchainSummary,
        },
        auditLogs,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not retrieve observation data.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
