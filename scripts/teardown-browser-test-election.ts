import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/lib/prisma";

function loadEnv() {
  const fullPath = resolve(".env");
  if (!existsSync(fullPath)) return;
  const content = readFileSync(fullPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnv();

async function main() {
  console.log("==================================================================");
  console.log("   TEARDOWN PERSISTENT PHASE 8 BROWSER TEST ELECTION (SEPOLIA)    ");
  console.log("==================================================================");

  const electionName = "Phase 8 Browser Test Election (Sepolia)";

  const election = await prisma.election.findFirst({
    where: { name: electionName },
  });

  if (!election) {
    console.log(`ℹ No test election with name "${electionName}" was found in database.`);
    return;
  }

  console.log(`Found election to teardown: "${election.name}" (ID: ${election.id})`);

  await prisma.$transaction(async (tx) => {
    const votesDeleted = await tx.electionVote.deleteMany({ where: { electionId: election.id } });
    const partDeleted = await tx.electionVoterParticipation.deleteMany({ where: { electionId: election.id } });
    const blocksDeleted = await tx.electionBlockchainBlock.deleteMany({ where: { electionId: election.id } });
    const authDeleted = await tx.electionAuthorityApproval.deleteMany({ where: { electionId: election.id } });
    const eligDeleted = await tx.electionEligibleVoter.deleteMany({ where: { electionId: election.id } });
    const candDeleted = await tx.electionCandidate.deleteMany({ where: { electionId: election.id } });
    await tx.election.delete({ where: { id: election.id } });

    console.log(`✓ Deleted ${votesDeleted.count} votes`);
    console.log(`✓ Deleted ${partDeleted.count} participation records`);
    console.log(`✓ Deleted ${blocksDeleted.count} internal blocks`);
    console.log(`✓ Deleted ${authDeleted.count} authority approvals`);
    console.log(`✓ Deleted ${eligDeleted.count} eligibility entries`);
    console.log(`✓ Deleted ${candDeleted.count} candidates`);
    console.log(`✓ Deleted Election "${election.name}" (${election.id})`);
  });

  console.log("\n==================================================================");
  console.log("✓ Teardown complete. Only the test election was removed.");
  console.log("  All user accounts and real data were preserved untouched.");
  console.log("==================================================================\n");
}

main()
  .catch((err) => {
    console.error("Teardown error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
