import readline from "node:readline";
import { createHash } from "node:crypto";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/database/prisma";

async function main() {
  console.log("=======================================================");
  console.log(" VoteChain — Clean-Slate Development/Demo Reset");
  console.log("=======================================================\n");
  console.log("WARNING: This will delete all demo elections, votes,");
  console.log("eligibility lists, test voters, test authorities, and tokens.");
  console.log("The ADMIN account and database schema will be preserved.\n");
  console.log("Ethereum Sepolia blockchain transactions are immutable and remain on-chain.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question("Type RESET to proceed with clean-slate demo reset: ", (val) => {
      resolve(val.trim());
    });
  });

  rl.close();

  if (answer !== "RESET") {
    console.log("\nAborted. No changes were made.");
    process.exit(0);
  }

  console.log("\nResetting database demo data...");

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

  await prisma.$transaction(async (tx) => {
    await tx.electionVote.deleteMany();
    await tx.electionVoterParticipation.deleteMany();
    await tx.electionBlockchainBlock.deleteMany();
    await tx.electionAuthorityApproval.deleteMany();
    await tx.electionTrustee.deleteMany();
    await tx.electionEligibleVoter.deleteMany();
    await tx.electionCandidate.deleteMany();
    await tx.election.deleteMany();
    await tx.verificationToken.deleteMany();
    await tx.user.deleteMany({
      where: { role: { not: UserRole.ADMIN } },
    });
    await tx.auditLog.deleteMany();
    await tx.auditLog.create({
      data: {
        eventType: "DEMO_ENVIRONMENT_RESET",
        actorReference: "cli:demo-reset",
        details: "Clean-slate demo reset executed via CLI tool.",
        eventHash: createHash("sha256").update(`DEMO_RESET_CLI:${Date.now()}`).digest("hex"),
      },
    });
  }, { timeout: 30000, maxWait: 15000 });

  console.log("\n✓ Clean-slate demo reset completed successfully!");
  console.log(`- Deleted Elections:   ${electionsCount}`);
  console.log(`- Deleted Votes:       ${votesCount}`);
  console.log(`- Deleted Test Voters: ${votersCount}`);
  console.log(`- Deleted Authorities: ${authoritiesCount}`);
  console.log(`- Deleted Tokens:      ${tokensCount}`);
  console.log("\nPreserved Admin account: admin.votechain@gmail.com");
  console.log("Sepolia Smart Contract:  0x7339F8B088A2835F26e158c9F96690395D80264D (immutable)");
}

main()
  .catch((err) => {
    console.error("\nReset failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
