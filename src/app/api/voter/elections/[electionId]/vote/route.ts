import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/database/prisma";
import { getCurrentUser } from "@/backend/auth/session";
import { appendNextBlockchainBlock, verifyBlockchainChain } from "@/blockchain/blockchain";
import { encryptBallot } from "@/security/encryption";
import { submitVoteOnChain } from "@/blockchain/ethereum";
import { checkVoterElectionEligibility } from "@/backend/voting/eligibility";
import { createVoteReceipt } from "@/verification/receipts";
import { validateVoteSubmission } from "@/backend/voting/voting";
import { createZkVoteProof, verifyZkVoteProof } from "@/security/zk-proof";
import { getElectionEncryptionKey } from "@/security/election-keys";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ electionId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (user.role !== "VOTER") {
    return NextResponse.json({ error: "Only registered student voters can cast ballots in campus elections." }, { status: 403 });
  }

  const { electionId } = await context.params;

  let candidateId: string | undefined;
  let offlineBuffered = false;
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
    offlineBuffered = Boolean((body as { offlineBuffered?: unknown }).offlineBuffered);
  } else {
    const formData = await request.formData();
    candidateId = typeof formData.get("candidateId") === "string" ? String(formData.get("candidateId")) : undefined;
  }

  if (!candidateId || typeof candidateId !== "string" || candidateId.length > 128) {
    return NextResponse.json({ error: "Choose a valid candidate before submitting your vote." }, { status: 400 });
  }

  const election = await prisma.election.findUnique({
    where: { id: electionId },
    include: {
      candidates: true,
      participations: { where: { voterId: user.id }, select: { id: true } },
      votes: { where: { voterId: user.id }, select: { id: true } },
    },
  });

  if (!election) return NextResponse.json({ error: "Election not found." }, { status: 404 });
  if (election.status !== "ACTIVE") {
    return NextResponse.json({ error: "Voting is only available while an election is active." }, { status: 409 });
  }

  const now = new Date();
  if (now < election.startTime || now >= election.endTime) {
    return NextResponse.json(
      { error: "Voting is only allowed during the active election time window." },
      { status: 409 }
    );
  }

  const eligibility = await checkVoterElectionEligibility({
    userId: user.id,
    email: user.email,
    voterId: user.voterId,
    role: user.role,
    emailVerified: Boolean(user.emailVerified),
    electionId: election.id,
  });

  if (!eligibility.ok) {
    return NextResponse.json({ error: eligibility.reason }, { status: 403 });
  }

  const validation = validateVoteSubmission({
    electionId: election.id,
    candidateId,
    validCandidateIds: election.candidates.map((candidate) => candidate.id),
    hasExistingVote: election.participations.length > 0 || election.votes.length > 0,
    startTime: election.startTime,
    endTime: election.endTime,
    now,
  });

  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  try {
    const voteId = crypto.randomUUID();
    const preliminaryReceipt = createVoteReceipt({
      electionId: election.id,
      voteId,
      submittedAt: new Date(),
    });

    const validCandidateIds = election.candidates.map((candidate) => candidate.id);
    const electionKey = getElectionEncryptionKey(election, { purpose: "vote_encryption" });
    const encryptedBallot = encryptBallot({
      electionId: election.id,
      candidateId,
      validCandidateIds,
      nonce: voteId,
      encryptionKey: electionKey,
    });

    // Generate and verify true Zero-Knowledge proof
    const zkVoteProof = await createZkVoteProof({
      electionId: election.id,
      candidateId,
      validCandidateIds,
      nonce: voteId,
    });

    const isZkValid = await verifyZkVoteProof({
      electionId: election.id,
      proof: zkVoteProof,
      validCandidateIds,
    });

    if (!isZkValid) {
      return NextResponse.json({ error: "Zero-knowledge proof validation failed for candidate choice." }, { status: 400 });
    }

    const ethereumReceipt = await submitVoteOnChain({
      electionId: election.id,
      ciphertext: encryptedBallot.ciphertext,
      proof: encryptedBallot.proof,
    });

    const receipt = {
      ...preliminaryReceipt,
      txHash: ethereumReceipt.transactionHash,
      blockNumber: ethereumReceipt.blockNumber,
      zkProof: zkVoteProof.proof,
      zkVerified: true,
      recoveredFromOfflineBuffer: offlineBuffered,
    };

    let nextBlock: ReturnType<typeof appendNextBlockchainBlock> | null = null;
    let voteRecord = null;
    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      try {
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

        nextBlock = appendNextBlockchainBlock({
          chain,
          payload: JSON.stringify({
            electionId: election.id,
            voteId: receipt.voteId,
            receiptId: receipt.receiptId,
            txHash: receipt.txHash,
            encryptedBallot: encryptedBallot.ciphertext,
            ballotNonce: encryptedBallot.nonce,
            ballotAuthTag: encryptedBallot.authTag,
            ballotProof: encryptedBallot.proof,
            zkProof: zkVoteProof.proof,
            blockNumber: receipt.blockNumber,
            submittedAt: receipt.submittedAt,
            recoveredFromOfflineBuffer: offlineBuffered,
          }),
        });

        voteRecord = await prisma.$transaction(
          async (transaction) => {
            // Identity / ballot separation:
            // Record voter participation (1 person 1 vote) separate from anonymous encrypted ballot
            await transaction.electionVoterParticipation.create({
              data: { electionId: election.id, voterId: user.id, votedAt: new Date() },
            });

            const createdVote = await transaction.electionVote.create({
              data: {
                id: receipt.voteId,
                electionId: election.id,
                receiptId: receipt.receiptId,
                txHash: receipt.txHash,
                encryptedBallot: encryptedBallot.ciphertext,
                ballotNonce: encryptedBallot.nonce,
                ballotAuthTag: encryptedBallot.authTag,
                ballotProof: encryptedBallot.proof,
                zkProof: zkVoteProof.proof,
                blockNumber: receipt.blockNumber,
                submittedAt: receipt.submittedAt,
              },
            });

            await transaction.electionBlockchainBlock.create({
              data: {
                electionId: election.id,
                index: nextBlock!.index,
                previousHash: nextBlock!.previousHash,
                payload: nextBlock!.payload,
                hash: nextBlock!.hash,
                timestamp: new Date(nextBlock!.timestamp),
              },
            });

            // Append-oriented audit log
            await transaction.auditLog.create({
              data: {
                eventType: "BALLOT_ACCEPTED",
                actorReference: `anonymous_credential:${receipt.receiptId.slice(0, 12)}`,
                electionId: election.id,
                details: `Encrypted ballot committed to block ${receipt.blockNumber}. Tx: ${receipt.txHash.slice(0, 16)}... ZK Proof verified.`,
                eventHash: createHash("sha256").update(`${election.id}:${receipt.receiptId}:${receipt.txHash}`).digest("hex"),
              },
            });

            return createdVote;
          },
          { maxWait: 10000, timeout: 15000 }
        );

        break;
      } catch (txErr) {
        const msg = txErr instanceof Error ? txErr.message : String(txErr);
        // If unique constraint on index failed, retry next block index
        if (msg.includes("Unique constraint") && msg.includes("index") && attempts < 3) {
          await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
          continue;
        }
        throw txErr;
      }
    }

    if (!voteRecord || !nextBlock) {
      throw new Error("The ballot could not be recorded after multiple attempts.");
    }

    if (contentType.includes("application/json")) {
      return NextResponse.json({ ok: true, vote: voteRecord, receipt, block: nextBlock }, { status: 201 });
    }

    const params = new URLSearchParams({
      receiptId: receipt.receiptId,
      electionId: receipt.electionId,
      voteId: receipt.voteId,
      txHash: receipt.txHash,
      blockNumber: String(receipt.blockNumber),
      recordHash: receipt.recordHash,
      submittedAt: receipt.submittedAt,
      zkVerified: "true",
    });

    return NextResponse.redirect(new URL(`/portal?${params.toString()}`, request.url));
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "";
    let message = "The ballot could not be recorded.";
    let status = 500;

    if (
      rawMessage.includes("ElectionVoterParticipation") ||
      rawMessage.includes("voterId") ||
      rawMessage.includes("already cast") ||
      rawMessage.includes("hasExistingVote")
    ) {
      message = "You have already cast a ballot in this election.";
      status = 409;
    } else if (rawMessage.includes("commitment already recorded")) {
      message = "This vote commitment has already been recorded on-chain.";
      status = 409;
    } else if (error instanceof Error && error.message) {
      message = error.message;
    }

    if (contentType.includes("application/json")) {
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.redirect(new URL("/portal?error=" + encodeURIComponent(message), request.url));
  }
}
