import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const emailArg = args[0] || process.env.ADMIN_EMAIL || "admin@votechain.local";
  const passwordArg = args[1] || process.env.ADMIN_PASSWORD;

  const email = emailArg.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    console.error("Error: A valid email address is required.");
    console.error("Usage: npx tsx --env-file=.env scripts/create-or-reset-admin.ts [email] [newPassword]");
    process.exit(1);
  }

  if (!passwordArg) {
    console.error("Error: A new password is required as the second argument (or set ADMIN_PASSWORD).");
    console.error("Usage: npx tsx --env-file=.env scripts/create-or-reset-admin.ts [email] [newPassword]");
    process.exit(1);
  }

  if (passwordArg.length < 12) {
    console.error("Error: Password must be at least 12 characters for administrative security.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(passwordArg, 12);

  const existing = await prisma.user.findUnique({
    where: { email },
  });

  if (existing) {
    await prisma.user.update({
      where: { email },
      data: {
        passwordHash,
        role: UserRole.ADMIN,
        status: "ACTIVE",
        emailVerified: true,
      },
    });
    console.log(`[VoteChain Admin] Successfully reset password for administrator account: ${email}`);
  } else {
    await prisma.user.create({
      data: {
        email,
        name: "VoteChain Administrator",
        passwordHash,
        role: UserRole.ADMIN,
        status: "ACTIVE",
        emailVerified: true,
      },
    });
    console.log(`[VoteChain Admin] Successfully created new administrator account: ${email}`);
  }
}

main()
  .catch((err) => {
    console.error("Error creating/resetting admin account:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
