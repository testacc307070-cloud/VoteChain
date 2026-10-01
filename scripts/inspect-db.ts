import { prisma } from "@/database/prisma";

async function main() {
  const elections = await prisma.election.findMany({
    include: {
      candidates: true,
      votes: true,
      participations: true,
      authorityApprovals: true,
      blocks: true,
    }
  });
  console.log(`\nFound ${elections.length} elections in database:`);
  for (const e of elections) {
    console.log(`\n--- Election: "${e.name}" (${e.id}) ---`);
    console.log(`  Status: ${e.status}`);
    console.log(`  Description: ${e.description}`);
    console.log(`  Candidates Locked: ${e.candidatesLocked}`);
    console.log(`  Candidates (${e.candidates.length}): ${e.candidates.map(c => `${c.name} [ID: ${c.id}]`).join(", ")}`);
    console.log(`  Eligible Voter IDs: ${JSON.stringify(e.eligibleVoterIds)}`);
    console.log(`  Required Authority Approvals: ${e.requiredAuthorityApprovals}`);
    console.log(`  Votes Count: ${e.votes.length}`);
    console.log(`  Participations Count: ${e.participations.length}`);
    console.log(`  Authority Approvals: ${e.authorityApprovals.length}`);
    console.log(`  Blocks Count: ${e.blocks.length}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
