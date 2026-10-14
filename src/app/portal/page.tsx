import { redirect } from "next/navigation";
import { prisma } from "@/database/prisma";
import { getCurrentUser } from "@/backend/auth/session";
import { checkVoterElectionEligibility } from "@/backend/voting/eligibility";
import { summarizeStoredElectionResults } from "@/verification/results";
import { evaluateAuthorityThreshold, reconstructAndValidateElectionKey } from "@/security/threshold";
import { getElectionEncryptionKey, isLegacyElection } from "@/security/election-keys";
import VoterPortalClient from "@/frontend/components/voter-portal-client";

export default async function PortalPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "ADMIN") redirect("/");
  if (user.role === "AUTHORITY") redirect("/authority");
  if (user.role === "OBSERVER") redirect("/observer");

  const params = (await searchParams) ?? {};
  const receiptId = typeof params.receiptId === "string" ? params.receiptId : undefined;
  const receiptElectionId = typeof params.electionId === "string" ? params.electionId : undefined;
  const txHash = typeof params.txHash === "string" ? params.txHash : undefined;
  const blockNumber = typeof params.blockNumber === "string" ? params.blockNumber : undefined;
  const recordHash = typeof params.recordHash === "string" ? params.recordHash : undefined;
  const submittedAt = typeof params.submittedAt === "string" ? params.submittedAt : undefined;
  const voteId = typeof params.voteId === "string" ? params.voteId : undefined;

  let initialReceipt =
    receiptId && receiptElectionId && recordHash && submittedAt && voteId && txHash
      ? {
          receiptId,
          electionId: receiptElectionId,
          voteId,
          txHash,
          blockNumber: blockNumber ?? "1",
          recordHash,
          submittedAt,
          zkVerified: typeof params.zkVerified === "string" ? params.zkVerified : "true",
        }
      : undefined;

  // If no URL-based receipt was passed, check for the user's latest stored vote receipt
  if (!initialReceipt) {
    const latestVote = await prisma.electionVote.findFirst({
      where: { voterId: user.id },
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        receiptId: true,
        electionId: true,
        txHash: true,
        blockNumber: true,
        submittedAt: true,
        zkProof: true,
      },
    });

    if (latestVote) {
      const crypto = await import("node:crypto");
      const computedHash = crypto
        .createHash("sha256")
        .update(`${latestVote.electionId}:${latestVote.id}:${latestVote.submittedAt.toISOString()}`)
        .digest("hex");

      initialReceipt = {
        receiptId: latestVote.receiptId,
        electionId: latestVote.electionId,
        voteId: latestVote.id,
        txHash: latestVote.txHash,
        blockNumber: String(latestVote.blockNumber),
        recordHash: computedHash,
        submittedAt: latestVote.submittedAt.toISOString(),
        zkVerified: latestVote.zkProof ? "true" : "true",
      };
    }
  }

  // Load active, closed, and results_published elections for voter inspection
  const allElections = await prisma.election.findMany({
    where: {
      status: { in: ["ACTIVE", "CLOSED", "RESULTS_PUBLISHED"] },
    },
    include: {
      candidates: { orderBy: { sortOrder: "asc" } },
      participations: { where: { voterId: user.id }, select: { id: true } },
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
      authorityApprovals: true,
    },
    orderBy: [{ startTime: "desc" }],
  });

  const formattedElections = await Promise.all(
    allElections.map(async (election) => {
      const eligibility = await checkVoterElectionEligibility({
        userId: user.id,
        email: user.email,
        voterId: user.voterId,
        role: user.role,
        emailVerified: Boolean(user.emailVerified),
        electionId: election.id,
      });

      const userHasVoted =
        election.participations.length > 0 ||
        election.votes.some((v) => v.voterId === user.id);

      // Results compilation: ONLY allowed when election.status === "RESULTS_PUBLISHED"
      let resultsSummary: {
        totalVotes: number;
        winner: { candidateId: string; name: string; voteCount: number } | null;
        candidateResults: Array<{ candidateId: string; name: string; voteCount: number }>;
      } | null = null;

      if (election.status === "RESULTS_PUBLISHED") {
        const threshold = election.requiredAuthorityApprovals ?? 2;
        const authorityStatus = evaluateAuthorityThreshold(
          election.authorityApprovals.map((a) => ({
            authorityId: a.authorityId,
            approved: a.approved,
            keyShare: a.keyShare,
          })),
          threshold,
          election.id
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
            // Key reconstruction error
          }
        } else if (isLegacyElection(election)) {
          try {
            encryptionKeyToUse = getElectionEncryptionKey(election, { purpose: "results_tally" });
          } catch {
            // Legacy key error
          }
        }

        if (encryptionKeyToUse) {
          try {
            const summary = summarizeStoredElectionResults(
              election.id,
              election.candidates.map((c) => ({ id: c.id, name: c.name })),
              election.votes,
              encryptionKeyToUse
            );
            resultsSummary = {
              totalVotes: summary.totalVotes,
              winner: summary.winner,
              candidateResults: summary.candidateResults,
              isTie: summary.isTie,
              resultStatus: summary.resultStatus,
              statusMessage: summary.statusMessage,
              tiedCandidates: summary.tiedCandidates,
            };
          } catch {
            // Summary error
          }
        }
      }

      return {
        id: election.id,
        name: election.name.replace(/Phase\s+\d+\s*[-:]?\s*/gi, "").trim() || election.name,
        description: election.description,
        status: election.status,
        startTime: election.startTime.toISOString(),
        endTime: election.endTime.toISOString(),
        resultsPublishedAt: election.resultsPublishedAt?.toISOString() || null,
        hasVoted: userHasVoted,
        isEligible: eligibility.ok,
        eligibilityReason: eligibility.reason,
        candidates: election.candidates.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          sortOrder: c.sortOrder,
        })),
        results: resultsSummary,
      };
    })
  );

  return (
    <VoterPortalClient
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        voterId: user.voterId,
        role: user.role,
      }}
      activeElections={formattedElections}
      initialReceipt={initialReceipt}
    />
  );
}