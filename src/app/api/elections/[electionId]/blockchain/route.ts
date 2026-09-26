import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildBlockchainSummary, verifyBlockchainChain } from "@/lib/blockchain";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ electionId: string }> }) {
  const { electionId } = await context.params;

  try {
    const election = await prisma.election.findUnique({
      where: { id: electionId },
      include: {
        blocks: { orderBy: { index: "asc" } },
      },
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found." }, { status: 404 });
    }

    const chain = election.blocks.map((block) => ({
      index: block.index,
      timestamp: block.timestamp.getTime(),
      previousHash: block.previousHash,
      payload: block.payload,
      hash: block.hash,
    }));

    const summary = buildBlockchainSummary(chain);

    return NextResponse.json({
      electionId: election.id,
      summary,
      valid: summary.valid && verifyBlockchainChain(chain),
      blocks: chain,
    });
  } catch {
    return NextResponse.json({ error: "Could not load ledger data." }, { status: 500 });
  }
}
