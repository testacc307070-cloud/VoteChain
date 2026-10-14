import { NextResponse } from "next/server";
import { prisma } from "@/database/prisma";
import { getCurrentUser } from "@/backend/auth/session";
import { verifyObserverSessionToken } from "@/backend/auth/observer-token";
import { buildBlockchainSummary, verifyBlockchainChain } from "@/blockchain/blockchain";
import { buildElectionIntegritySnapshot } from "@/verification/merkle";
import { summarizeStoredElectionResults } from "@/verification/results";
import { evaluateAuthorityThreshold, reconstructAndValidateElectionKey } from "@/security/threshold";
import { getElectionEncryptionKey, isLegacyElection } from "@/security/election-keys";

export const runtime = "nodejs";

/**
 * GET /api/elections/[electionId]/observe/data
 * Returns read-only observation data for the authorized election.
 * Requires either an active ADMIN / OBSERVER session OR a valid scoped observer session token.
 * Strips all voter identities, student IDs, private keys, DEKs, and Shamir shares.
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
          },
        },
        blocks: {
          orderBy: { index: "asc" },
          select: {
            id: true,
            index: true,
            previousHash: true,
            payload: true,
            hash: true,
            timestamp: true,
          },
        },
        authorityApprovals: true,
        votes: {
          select: {
            candidateId: true,
            voterId: true,
            encryptedBallot: true,
            ballotNonce: true,
            ballotAuthTag: true,
            ballotProof: true,
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

    // Authorization verification
    const currentUser = await getCurrentUser();
    const isAdminOrObserver = currentUser && (currentUser.role === "ADMIN" || currentUser.role === "OBSERVER");

    if (!isAdminOrObserver) {
      // Check token in header or search params
      const authHeader = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
      const customHeader = request.headers.get("x-observer-token") || "";
      const urlToken = new URL(request.url).searchParams.get("token") || "";
      const token = (authHeader || customHeader || urlToken).trim();

      if (!token) {
        return NextResponse.json(
          { error: "Observer access token required to view this election dashboard." },
          { status: 401 }
        );
      }

      if (!election.observerAccessCodeHash) {
        return NextResponse.json(
          { error: "Observer access code has been revoked by the election administrator." },
          { status: 403 }
        );
      }

      const isValidToken = verifyObserverSessionToken(token, election.id, election.observerAccessCodeHash);
      if (!isValidToken) {
        return NextResponse.json(
          { error: "Invalid, expired, or revoked observer access session. Please re-enter your code." },
          { status: 401 }
        );
      }
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

    // Only compute official final results if results are officially published
    let publishedSummary = null;
    if (isResultsPublished) {
      const threshold = election.requiredAuthorityApprovals ?? 2;
      const authorityStatus = evaluateAuthorityThreshold(
        election.authorityApprovals.map((a) => ({
          authorityId: a.authorityId,
          approved: a.approved,
          keyShare: a.keyShare,
        })),
        threshold,
        election.id,
      );

      let encryptionKeyToUse: string | undefined = undefined;
      if (authorityStatus.canReconstructKey) {
        const submittedShares = election.authorityApprovals
          .filter((a) => a.approved && a.keyShare && a.keyShare.startsWith("keyshare:"))
          .map((a) => a.keyShare as string);
        try {
          encryptionKeyToUse = reconstructAndValidateElectionKey({
            electionId: election.id,
            keyCommitment: election.keyCommitment,
            shares: submittedShares,
            threshold,
          });
        } catch {
          // Key reconstruction failed
        }
      } else if (isLegacyElection(election)) {
        try {
          encryptionKeyToUse = getElectionEncryptionKey(election, { purpose: "results_tally" });
        } catch {
          // Legacy key failed
        }
      }

      if (encryptionKeyToUse) {
        try {
          publishedSummary = summarizeStoredElectionResults(
            election.id,
            election.candidates.map((c) => ({ id: c.id, name: c.name })),
            election.votes,
            encryptionKeyToUse
          );
        } catch {
          // Tally compilation error fallback
        }
      }
    }

    const candidateResultsMap = new Map<string, number>();
    if (publishedSummary) {
      for (const res of publishedSummary.candidateResults) {
        candidateResultsMap.set(res.candidateId, res.voteCount);
      }
    }

    const candidates = election.candidates.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      sortOrder: c.sortOrder,
      voteCount: isResultsPublished && publishedSummary ? (candidateResultsMap.get(c.id) ?? 0) : null,
    }));

    const chainBlocks = election.blocks.map((b) => ({
      index: b.index,
      previousHash: b.previousHash,
      hash: b.hash,
      payload: b.payload,
      timestamp: b.timestamp.getTime(),
    }));

    const blockchainSummary = buildBlockchainSummary(chainBlocks);
    const isChainValid = verifyBlockchainChain(chainBlocks);

    const integrity = buildElectionIntegritySnapshot({
      electionId: election.id,
      totalVotes: election._count.votes,
      validVotes: election._count.votes,
      invalidVotes: 0,
      blockHeight: election.blocks.length,
    });

    const totalVotes = election._count.votes;
    const totalEligible = election._count.eligibleVoters;
    const turnoutPercentage = totalEligible > 0 ? Math.round((totalVotes / totalEligible) * 100) : null;

    return NextResponse.json({
      ok: true,
      election: {
        id: election.id,
        name: election.name.replace(/Phase\s+\d+\s*[-:]?\s*/gi, "").trim() || election.name,
        description: election.description,
        status: election.status,
        startTime: election.startTime.toISOString(),
        endTime: election.endTime.toISOString(),
        resultsPublishedAt: election.resultsPublishedAt?.toISOString() || null,
        totalVotesCast: totalVotes,
        totalEligibleVoters: totalEligible,
        turnoutPercentage,
        merkleRoot: election.merkleRoot || integrity.merkleRoot,
        candidates,
        winner: isResultsPublished && publishedSummary?.winner ? publishedSummary.winner : null,
        blockchain: {
          blockCount: election.blocks.length,
          blocks: election.blocks.slice(-10).map((b) => ({
            id: b.id,
            index: b.index,
            previousHash: b.previousHash,
            hash: b.hash,
            timestamp: b.timestamp.toISOString(),
          })),
          summary: blockchainSummary,
          isChainValid,
        },
        auditLogs,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not retrieve observation data.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
