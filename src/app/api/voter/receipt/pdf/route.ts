import { NextResponse } from "next/server";
import { prisma } from "@/database/prisma";
import { getCurrentUser } from "@/backend/auth/session";
import { generateReceiptPdf } from "@/backend/receipt/pdf-generator";
import { createMerkleProof, createMerkleRoot, verifyMerkleProof } from "@/verification/merkle";
import { verifyVoteReceipt } from "@/verification/receipts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const electionId = searchParams.get("electionId")?.trim() || "";
  const receiptId = searchParams.get("receiptId")?.trim() || "";
  const voteId = searchParams.get("voteId")?.trim() || "";
  const recordHashParam = searchParams.get("recordHash")?.trim() || "";

  if (!electionId) {
    return NextResponse.json({ error: "Missing electionId query parameter." }, { status: 400 });
  }

  try {
    // 1. Authorization check: Voters may ONLY download receipts for elections they voted in
    if (user.role === "VOTER") {
      const participation = await prisma.electionVoterParticipation.findUnique({
        where: {
          electionId_voterId: {
            electionId,
            voterId: user.id,
          },
        },
      });

      if (!participation) {
        return NextResponse.json(
          { error: "You have not cast a ballot in this election." },
          { status: 403 }
        );
      }
    } else if (user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Receipt downloads are restricted to authorized voters and administrators." },
        { status: 403 }
      );
    }

    // 2. Locate the specific vote record
    let vote = null;

    // Check if vote record has voterId bound
    if (user.role === "VOTER") {
      vote = await prisma.electionVote.findFirst({
        where: {
          electionId,
          voterId: user.id,
        },
      });
    }

    // If not found by voterId (e.g. historical decoupled ballot), find by voteId or receiptId
    if (!vote && (voteId || receiptId)) {
      vote = await prisma.electionVote.findFirst({
        where: {
          electionId,
          ...(voteId ? { id: voteId } : { receiptId }),
        },
      });

      // Strict security: if the vote record is bound to another voter, DENY access
      if (vote && vote.voterId && user.role === "VOTER" && vote.voterId !== user.id) {
        return NextResponse.json(
          { error: "You are not authorized to download this receipt." },
          { status: 403 }
        );
      }
    }

    if (!vote) {
      return NextResponse.json(
        { error: "Vote receipt record not found for this election." },
        { status: 404 }
      );
    }

    // Fetch election details
    const election = await prisma.election.findUnique({
      where: { id: electionId },
      select: {
        id: true,
        name: true,
        merkleRoot: true,
      },
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found." }, { status: 404 });
    }

    // Calculate Merkle inclusion proof
    const allVotes = await prisma.electionVote.findMany({
      where: { electionId },
      orderBy: { submittedAt: "asc" },
      select: { id: true, receiptId: true, txHash: true },
    });

    const voteHashes = allVotes.map((v) => `${v.receiptId}:${v.txHash}`);
    const targetHash = `${vote.receiptId}:${vote.txHash}`;
    const voteIndex = voteHashes.indexOf(targetHash);

    let merkleRoot = election.merkleRoot;
    let merkleProofVerified = false;

    if (voteIndex >= 0 && voteHashes.length > 0) {
      const computedRoot = createMerkleRoot(voteHashes);
      if (!merkleRoot) {
        merkleRoot = computedRoot;
      }
      const proof = createMerkleProof(voteHashes, voteIndex);
      merkleProofVerified = verifyMerkleProof(targetHash, proof, merkleRoot);
    }

    // Calculate or verify record hash
    let calculatedRecordHash = recordHashParam;
    if (!calculatedRecordHash) {
      const crypto = await import("node:crypto");
      calculatedRecordHash = crypto
        .createHash("sha256")
        .update(`${election.id}:${vote.id}:${vote.submittedAt.toISOString()}`)
        .digest("hex");
    }

    // Construct verification URL
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
    const proto = request.headers.get("x-forwarded-proto") || "https";
    const verificationUrl = `${proto}://${host}/verify?electionId=${encodeURIComponent(election.id)}&voteId=${encodeURIComponent(vote.id)}&submittedAt=${encodeURIComponent(vote.submittedAt.toISOString())}&recordHash=${encodeURIComponent(calculatedRecordHash)}`;

    // Generate PDF
    const pdfBuffer = generateReceiptPdf({
      electionName: election.name,
      electionId: election.id,
      receiptId: vote.receiptId,
      voteId: vote.id,
      txHash: vote.txHash,
      blockNumber: vote.blockNumber,
      recordHash: calculatedRecordHash,
      submittedAt: vote.submittedAt.toISOString(),
      ballotProof: vote.ballotProof,
      zkProof: vote.zkProof,
      merkleRoot,
      merkleProofVerified,
      verificationUrl,
    });

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="VoteChain-Receipt-${vote.receiptId}.pdf"`,
        "Content-Length": String(pdfBuffer.length),
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to generate receipt PDF.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
