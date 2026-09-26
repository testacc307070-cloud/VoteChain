import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { appendNextBlockchainBlock, verifyBlockchainChain } from "@/lib/blockchain";
import { encryptBallot } from "@/lib/encrypted-ballot";
import { submitVoteOnChain } from "@/lib/ethereum";
import { checkElectionEligibility } from "@/lib/eligibility";
import { createVoteReceipt, validateVoteSubmission } from "@/lib/voting";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ electionId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (user.role === "ADMIN") return NextResponse.json({ error: "Administrators cannot vote." }, { status: 403 });

  const { electionId } = await context.params;

  let candidateId: string | undefined;
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Vote payload must be valid JSON." }, { status: 400 });
    }

    if (!body || typeof body !== "object" || !("candidateId" in body)) {
      return NextResponse.json({ error: "Choose a candidate before submitting your vote." }, { status: 400 });
    }

    candidateId = (body as { candidateId?: unknown }).candidateId as string | undefined;
  } else {
    const formData = await request.formData();
    candidateId = typeof formData.get("candidateId") === "string" ? String(formData.get("candidateId")) : undefined;
  }

  if (!candidateId || typeof candidateId !== "string") {
    return NextResponse.json({ error: "Choose a valid candidate before submitting your vote." }, { status: 400 });
  }

  const election = await prisma.election.findUnique({
    where: { id: electionId },
    include: {
      candidates: true,
      votes: { where: { voterId: user.id } },
    },
  });

  if (!election) return NextResponse.json({ error: "Election not found." }, { status: 404 });
  if (election.status !== "ACTIVE") return NextResponse.json({ error: "Voting is only available while an election is active." }, { status: 409 });

  const eligibility = checkElectionEligibility({
    userId: user.id,
    eligibleVoterIds: election.eligibleVoterIds.length > 0 ? election.eligibleVoterIds : [user.id],
    isEligible: user.role === "VOTER",
  });

  if (!eligibility.ok) {
    return NextResponse.json({ error: eligibility.reason }, { status: 403 });
  }

  const validation = validateVoteSubmission({
    electionId: election.id,
    candidateId,
    validCandidateIds: election.candidates.map((candidate) => candidate.id),
    hasExistingVote: election.votes.length > 0,
  });

  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  try {
    const voteId = crypto.randomUUID();
    const preliminaryReceipt = createVoteReceipt({
      electionId: election.id,
      voteId,
      candidateId,
      submittedAt: new Date(),
    });
    const encryptedBallot = encryptBallot({
      electionId: election.id,
      voterId: user.id,
      candidateId,
      validCandidateIds: election.candidates.map((candidate) => candidate.id),
      nonce: voteId,
    });
    const ethereumReceipt = await submitVoteOnChain({
      electionId: election.id,
      ciphertext: encryptedBallot.ciphertext,
      proof: encryptedBallot.proof,
    });
    const receipt = {
      ...preliminaryReceipt,
      txHash: ethereumReceipt.transactionHash,
      blockNumber: ethereumReceipt.blockNumber,
    };

    const existingBlocks: Array<{
      index: number;
      timestamp: Date;
      previousHash: string;
      payload: string;
      hash: string;
    }> = await prisma.electionBlockchainBlock.findMany({
      where: { electionId: election.id },
      orderBy: { index: "asc" },
    });

    const chain = existingBlocks.map((block) => ({
      index: block.index,
      timestamp: block.timestamp.getTime(),
      previousHash: block.previousHash,
      payload: block.payload,
      hash: block.hash,
    }));

    if (existingBlocks.length > 0 && !verifyBlockchainChain(chain)) {
      throw new Error("Election blockchain integrity check failed.");
    }

    const nextBlock = appendNextBlockchainBlock({
      chain,
      payload: JSON.stringify({
        electionId: election.id,
        voteId: receipt.voteId,
        candidateId,
        receiptId: receipt.receiptId,
        txHash: receipt.txHash,
        encryptedBallot: encryptedBallot.ciphertext,
        ballotNonce: encryptedBallot.nonce,
        ballotAuthTag: encryptedBallot.authTag,
        ballotProof: encryptedBallot.proof,
        blockNumber: receipt.blockNumber,
        submittedAt: receipt.submittedAt,
      }),
    });

    const vote = await prisma.electionVote.create({
      data: {
        id: receipt.voteId,
        electionId: election.id,
        voterId: user.id,
        candidateId,
        receiptId: receipt.receiptId,
        txHash: receipt.txHash,
        encryptedBallot: encryptedBallot.ciphertext,
        ballotNonce: encryptedBallot.nonce,
        ballotAuthTag: encryptedBallot.authTag,
        ballotProof: encryptedBallot.proof,
        blockNumber: receipt.blockNumber,
        submittedAt: receipt.submittedAt,
      },
    });

    await prisma.electionBlockchainBlock.create({
      data: {
        electionId: election.id,
        index: nextBlock.index,
        previousHash: nextBlock.previousHash,
        payload: nextBlock.payload,
        hash: nextBlock.hash,
        timestamp: new Date(nextBlock.timestamp),
      },
    });

    if (contentType.includes("application/json")) {
      return NextResponse.json({ ok: true, vote, receipt, block: nextBlock }, { status: 201 });
    }

    const params = new URLSearchParams({
      receiptId: receipt.receiptId,
      electionId: receipt.electionId,
      voteId: receipt.voteId,
      txHash: receipt.txHash,
      blockNumber: String(receipt.blockNumber),
      recordHash: receipt.recordHash,
      submittedAt: receipt.submittedAt,
    });

    return NextResponse.redirect(new URL(`/portal?${params.toString()}`, request.url));
  } catch {
    if (contentType.includes("application/json")) {
      return NextResponse.json({ error: "The ballot could not be recorded." }, { status: 500 });
    }
    return NextResponse.redirect(new URL("/portal", request.url));
  }
}
