import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "admin@votechain.local").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "adminPassword123!";
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

  const defaultPassword = "demoPassword123!";
  const defaultPasswordHash = await bcrypt.hash(defaultPassword, 12);

  const testAccounts = [
    { role: UserRole.VOTER, voterId: "VTR-1001", name: "Alice Voter", email: process.env.VOTER_EMAIL || "voter@votechain.local", password: process.env.VOTER_PASSWORD || defaultPassword },
    { role: UserRole.VOTER, voterId: "VTR-1002", name: "Bob Voter", email: "voter2@votechain.local", password: defaultPassword },
    { role: UserRole.OBSERVER, voterId: null, name: "Audit Observer", email: process.env.OBSERVER_EMAIL || "observer@votechain.local", password: process.env.OBSERVER_PASSWORD || defaultPassword },
    { role: UserRole.AUTHORITY, voterId: null, name: "Election Trustee A", email: process.env.AUTHORITY_EMAIL || "authority@votechain.local", password: process.env.AUTHORITY_PASSWORD || defaultPassword },
    { role: UserRole.AUTHORITY, voterId: null, name: "Election Trustee B", email: "authority2@votechain.local", password: defaultPassword },
    { role: UserRole.AUTHORITY, voterId: null, name: "Election Trustee C", email: "authority3@votechain.local", password: defaultPassword },
  ];

  for (const account of testAccounts) {
    const hash = account.password === defaultPassword ? defaultPasswordHash : await bcrypt.hash(account.password, 12);
    const user = await prisma.user.upsert({
      where: { email: account.email.trim().toLowerCase() },
      update: { name: account.name, role: account.role, voterId: account.voterId, passwordHash: hash, status: "ACTIVE" },
      create: { email: account.email.trim().toLowerCase(), name: account.name, role: account.role, voterId: account.voterId, passwordHash: hash },
    });
    console.info(`Seeded ${account.role.toLowerCase()}: ${user.email} (${account.name})`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());