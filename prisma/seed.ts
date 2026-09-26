import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error("Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters before seeding.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name: "VoteChain Administrator", role: UserRole.ADMIN, status: "ACTIVE" },
    create: { email, passwordHash, name: "VoteChain Administrator", role: UserRole.ADMIN },
  });
  console.info(`Seeded administrator account: ${email}`);

  const testAccounts = [
    { role: UserRole.VOTER, name: "Demo Voter", email: process.env.VOTER_EMAIL, password: process.env.VOTER_PASSWORD },
    { role: UserRole.OBSERVER, name: "Demo Observer", email: process.env.OBSERVER_EMAIL, password: process.env.OBSERVER_PASSWORD },
    { role: UserRole.AUTHORITY, name: "Demo Authority", email: process.env.AUTHORITY_EMAIL, password: process.env.AUTHORITY_PASSWORD },
  ];
  for (const account of testAccounts) {
    if (!account.email && !account.password) continue;
    if (!account.email || !account.password || account.password.length < 12) {
      throw new Error(`Set both ${account.role}_EMAIL and ${account.role}_PASSWORD (12+ characters), or leave both unset.`);
    }
    const passwordHash = await bcrypt.hash(account.password, 12);
    await prisma.user.upsert({
      where: { email: account.email.trim().toLowerCase() },
      update: { name: account.name, role: account.role, passwordHash, status: "ACTIVE" },
      create: { email: account.email.trim().toLowerCase(), name: account.name, role: account.role, passwordHash },
    });
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());