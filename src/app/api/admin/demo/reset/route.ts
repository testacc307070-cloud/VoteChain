import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { UserRole } from "@prisma/client";
import { prisma } from "@/database/prisma";
import { requireAdminApi } from "@/backend/voting/admin-api";

export const runtime = "nodejs";

/**
 * POST /api/admin/demo/reset
 * SAFE Development/Demo Clean-Slate Reset
 * 
 * Requirements:
 * - Strictly restricted to authenticated ADMIN accounts.
 * - Requires explicit confirmation payload { confirmation: "RESET" }.
 * - Deletes all test elections, candidates, votes, participations, trustees,
 *   eligible voter lists, test authorities, test voters, and verification tokens.
 * - Preserves the authenticated ADMIN account and required production configuration.
 * - Leaves immutable Sepolia blockchain transactions and contracts untouched.
 */
export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request payload." }, { status: 400 });
  }

  const { confirmation } = (body || {}) as { confirmation?: string };
  if (confirmation !== "RESET") {
    return NextResponse.json(
      { error: "Confirmation keyword 'RESET' is required to execute clean-slate demo reset." },
      { status: 400 }
    );
  }

  try {
    // 1. Gather counts of demo records for auditing and feedback
    const [
      electionsCount,
      votesCount,
      votersCount,
      authoritiesCount,
      tokensCount,
    ] = await Promise.all([
      prisma.election.count(),
      prisma.electionVote.count(),
      prisma.user.count({ where: { role: UserRole.VOTER } }),
      prisma.user.count({ where: { role: UserRole.AUTHORITY } }),
      prisma.verificationToken.count(),
    ]);

    // 2. Execute atomic clean-slate reset
    await prisma.$transaction(async (tx) => {
      // Clear vote & participation records
      await tx.electionVote.deleteMany();
      await tx.electionVoterParticipation.deleteMany();

      // Clear blockchain cached block records
      await tx.electionBlockchainBlock.deleteMany();

      // Clear threshold approvals & trustees
      await tx.electionAuthorityApproval.deleteMany();
      await tx.electionTrustee.deleteMany();

      // Clear eligibility rosters & candidates
      await tx.electionEligibleVoter.deleteMany();
      await tx.electionCandidate.deleteMany();

      // Clear all demo elections
      await tx.election.deleteMany();

      // Clear tokens
      await tx.verificationToken.deleteMany();

      // Clear test voters and test authorities (preserve ADMIN accounts)
      await tx.user.deleteMany({
        where: { role: { not: UserRole.ADMIN } },
      });

      // Clear audit log records and initialize one clean reset record
      await tx.auditLog.deleteMany();
      await tx.auditLog.create({
        data: {
          eventType: "DEMO_ENVIRONMENT_RESET",
          actorReference: `admin:${auth.user.email}`,
          details: `Clean-slate demo reset executed by ${auth.user.email}. Preserved admin account and schema.`,
          eventHash: createHash("sha256").update(`DEMO_RESET:${Date.now()}:${auth.user.email}`).digest("hex"),
        },
      });
    }, { timeout: 30000, maxWait: 15000 });

    return NextResponse.json({
      ok: true,
      message: "Clean-slate demo reset completed successfully. Application database is restored to a brand-new state.",
      preservedAdmin: auth.user.email,
      deleted: {
        elections: electionsCount,
        votes: votesCount,
        voters: votersCount,
        authorities: authoritiesCount,
        tokens: tokensCount,
      },
      blockchainNotice:
        "Sepolia Ethereum smart contract (0x7339F8B088A2835F26e158c9F96690395D80264D) is an immutable distributed ledger and is unaffected by local database resets. Future elections will use fresh, unique election IDs.",
    });
  } catch (error) {
    console.error("Clean-slate demo reset failed:", error);
    const message = error instanceof Error ? error.message : "Clean-slate reset failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
