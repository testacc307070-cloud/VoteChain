import { prisma } from "../src/lib/prisma";
import bcrypt from "bcryptjs";

async function main() {
  const users = await prisma.user.findMany();
  console.log(`\nFound ${users.length} users in database:`);

  const candidatePasswords = [
    "adminPassword123!",
    "quVo-Ss2BZ4MHNmUPx85Q24X9lRAELsivGkI9UqX3aE",
    "VoteChainAdminPassword123!",
    "voterPassword123!",
    "VoteChainVoterPassword123!",
    "observerPassword123!",
    "VoteChainObserverPassword123!",
    "authorityPassword123!",
    "VoteChainAuthorityPassword123!",
    "demoPassword123!",
  ];

  for (const user of users) {
    let found = "NONE OF TEST PASSWORDS MATCHED";
    for (const pw of candidatePasswords) {
      if (await bcrypt.compare(pw, user.passwordHash)) {
        found = pw;
        break;
      }
    }
    console.log(`- User: ${user.email.padEnd(28)} | Role: ${user.role.padEnd(10)} | Password: ${found}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
