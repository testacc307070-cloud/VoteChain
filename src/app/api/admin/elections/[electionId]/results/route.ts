import { NextResponse } from "next/server";
import { prisma } from "@/database/prisma";
import { requireAdminApi } from "@/backend/voting/admin-api";
import { createElectionAuditDigest, summarizeStoredElectionResults } from "@/verification/results";
import { evaluateAuthorityThreshold, reconstructAndValidateElectionKey } from "@/security/threshold";
import { getElectionEncryptionKey, isLegacyElection } from "@/security/election-keys";

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
      },
    });

    if (!election) return NextResponse.json({ error: "Election not found." }, { status: 404 });
    if (election.status !== "CLOSED" && election.status !== "RESULTS_PUBLISHED") {
      return NextResponse.json({ error: "Results are available only after the election closes." }, { status: 409 });
    }

    const thresholdResult = evaluateAuthorityThreshold(
      election.authorityApprovals.map((a) => ({
        authorityId: a.authorityId,
        approved: a.approved,
        keyShare: a.keyShare,
      })),
      election.requiredAuthorityApprovals ?? 2,
      election.id,
    );

    let encryptionKeyToUse: string | undefined = undefined;
    const submittedShares = election.authorityApprovals
      .filter((a) => a.approved && a.keyShare && a.keyShare.startsWith("keyshare:"))
      .map((a) => a.keyShare as string);

    if (thresholdResult.canReconstructKey && submittedShares.length >= (election.requiredAuthorityApprovals ?? 2)) {
      try {
        encryptionKeyToUse = reconstructAndValidateElectionKey({
          electionId: election.id,
          keyCommitment: election.keyCommitment,
          shares: submittedShares,
          threshold: election.requiredAuthorityApprovals ?? 2,
        });
      } catch (reconstructError) {
        const msg = reconstructError instanceof Error ? reconstructError.message : "Key reconstruction failed";
        return NextResponse.json({
          error: `Threshold key reconstruction failed: ${msg}`,
          thresholdResult,
        }, { status: 400 });
      }
    } else if (isLegacyElection(election)) {
      // Historical/test elections created before Phase 9.1 don't have an encryptedMasterKey envelope.
      // Allow legacy decryption fallback for backward compatibility.
      encryptionKeyToUse = getElectionEncryptionKey(election, { purpose: "results_tally" });
    } else {
      return NextResponse.json({
        error: `Results tallying is locked until ${election.requiredAuthorityApprovals ?? 2} authorities submit valid key shares (Current valid shares: ${thresholdResult.sharesSubmitted}).`,
        thresholdResult,
      }, { status: 403 });
    }

    const summary = summarizeStoredElectionResults(
      election.id,
      election.candidates.map((candidate) => ({ id: candidate.id, name: candidate.name })),
      election.votes,
      encryptionKeyToUse,
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
        requiredAuthorityApprovals: election.requiredAuthorityApprovals,
      },
      thresholdResult,
      summary,
      auditDigest,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not compile election results.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
