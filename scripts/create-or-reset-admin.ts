import readline from "node:readline";
import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

function promptHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(query);

    if (stdin.isTTY) {
      let password = "";
      stdin.setRawMode(true);
      stdin.resume();

      const onData = (chunk: Buffer) => {
        const str = chunk.toString("utf8");
        for (const char of str) {
          if (char === "\n" || char === "\r" || char === "\u0004") {
            stdin.removeListener("data", onData);
            stdin.setRawMode(false);
            stdin.pause();
            process.stdout.write("\n");
            resolve(password);
            return;
          } else if (char === "\u0003") {
            // Ctrl+C
            stdin.setRawMode(false);
            process.stdout.write("\n");
            process.exit(1);
          } else if (char === "\b" || char === "\x7f") {
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write("\b \b");
            }
          } else {
            password += char;
            process.stdout.write("*");
          }
        }
      };

      stdin.on("data", onData);
    } else {
      // Non-interactive fallback (e.g. piped input in automated test)
      const rl = readline.createInterface({
        input: stdin,
        output: process.stdout,
      });
      rl.question("", (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

function validateAdminPassword(password: string): { valid: boolean; reason?: string } {
  if (password.length < 12) {
    return { valid: false, reason: "Password must be at least 12 characters for administrative security." };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, reason: "Password must contain at least one uppercase letter (A-Z)." };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, reason: "Password must contain at least one lowercase letter (a-z)." };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, reason: "Password must contain at least one numeric digit (0-9)." };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
    return { valid: false, reason: "Password must contain at least one special symbol (!@#$%^&*)." };
  }
  return { valid: true };
}

async function main() {
  const args = process.argv.slice(2);

  // Security enforcement: forbid passing passwords on the command line
  if (args.length > 1) {
    console.error("================================================================================");
    console.error("SECURITY VIOLATION: Passwords must NEVER be passed as command-line arguments.");
    console.error("Passing passwords as arguments leaks them into process lists and shell history.");
    console.error("Usage: npx tsx --env-file=.env scripts/create-or-reset-admin.ts [email]");
    console.error("================================================================================");
    process.exit(1);
  }

  const emailArg = args[0] || process.env.ADMIN_EMAIL || "admin.votechain@gmail.com";
  const email = emailArg.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    console.error("Error: A valid administrator email address is required.");
    console.error("Usage: npx tsx --env-file=.env scripts/create-or-reset-admin.ts [email]");
    process.exit(1);
  }

  console.log(`[VoteChain Admin Setup] Configuring administrator account for: ${email}`);

  // Hidden password prompt
  const password = await promptHidden("Enter new admin password: ");
  if (!password) {
    console.error("Error: Password cannot be empty.");
    process.exit(1);
  }

  const check = validateAdminPassword(password);
  if (!check.valid) {
    console.error(`Error: ${check.reason}`);
    process.exit(1);
  }

  // Password confirmation prompt
  const confirmPassword = await promptHidden("Confirm new admin password: ");
  if (password !== confirmPassword) {
    console.error("Error: Password confirmation does not match.");
    process.exit(1);
  }

  console.log("[VoteChain Admin Setup] Generating Bcrypt hash (cost factor 12)...");
  const passwordHash = await bcrypt.hash(password, 12);

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
    console.log(`[VoteChain Admin] Successfully reset password for administrator: ${email}`);
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
    console.log(`[VoteChain Admin] Successfully created new administrator: ${email}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[VoteChain Admin] Fatal error provisioning administrator:", err);
  process.exit(1);
});
