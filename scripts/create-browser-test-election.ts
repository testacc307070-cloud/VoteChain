import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/lib/prisma";
import { checkVoterElectionEligibility } from "../src/lib/eligibility";

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
  console.log("   CREATING PERSISTENT PHASE 8 BROWSER TEST ELECTION (SEPOLIA)    ");
  console.log("==================================================================");

  const electionName = "Phase 8 Browser Test Election (Sepolia)";
  const targetEmail = "24n236@psgtech.ac.in";
  const targetStudentId = "24N236";

  // 1. Verify target voter exists in database
  const voter = await prisma.user.findUnique({
    where: { email: targetEmail },
  });

  if (!voter) {
    throw new Error(`Target voter account ${targetEmail} not found in database.`);
  }

  console.log(`✓ Target voter found: ${voter.name} (${voter.email})`);
  console.log(`  - Student ID: ${voter.voterId}`);
  console.log(`  - Role      : ${voter.role}`);
  console.log(`  - Verified  : ${voter.emailVerified}`);

  // 2. Find admin user to assign as creator
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
  });

  if (!admin) {
    throw new Error("No admin account found in database to assign as election creator.");
  }
  console.log(`✓ Election creator set to admin: ${admin.email}`);

  // 3. Check if test election already exists
  const existing = await prisma.election.findFirst({
    where: { name: electionName },
    include: {
      candidates: true,
      eligibleVoters: true,
    },
  });

  let election = existing;

  if (election) {
    console.log(`\n⚠ Existing test election found with ID: ${election.id}`);
    console.log(`  Status: ${election.status}`);
    // Ensure active and eligible
    if (election.status !== "ACTIVE") {
      election = await prisma.election.update({
        where: { id: election.id },
        data: { status: "ACTIVE" },
        include: { candidates: true, eligibleVoters: true },
      });
      console.log(`  Updated status to ACTIVE.`);
    }

    const isEligiblePresent = election.eligibleVoters.some(
      (ev) => ev.email.toLowerCase() === targetEmail.toLowerCase()
    );

    if (!isEligiblePresent) {
      await prisma.electionEligibleVoter.create({
        data: {
          electionId: election.id,
          email: targetEmail,
          studentId: targetStudentId,
        },
      });
      console.log(`  Added ${targetEmail} to eligibility register.`);
    }
  } else {
    // 4. Create new persistent election
    const now = new Date(Date.now() - 5 * 60 * 1000); // 5 mins ago to ensure active
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    election = await prisma.election.create({
      data: {
        name: electionName,
        description: "Controlled browser test election on Ethereum Sepolia for Phase 8 verification",
        status: "ACTIVE",
        startTime: now,
        endTime: nextWeek,
        createdById: admin.id,
        candidates: {
          create: [
            { name: "Candidate 1", description: "First choice for Phase 8 test", sortOrder: 0 },
            { name: "Candidate 2", description: "Second choice for Phase 8 test", sortOrder: 1 },
          ],
        },
        eligibleVoters: {
          create: [
            {
              email: targetEmail,
              studentId: targetStudentId,
            },
          ],
        },
      },
      include: {
        candidates: { orderBy: { sortOrder: "asc" } },
        eligibleVoters: true,
      },
    });
    console.log(`\n✓ Created persistent election: "${election.name}"`);
  }

  // 5. Verify the election state
  console.log("\n==================================================================");
  console.log("                    ELECTION VERIFICATION CHECK                   ");
  console.log("==================================================================");
  console.log(`Election ID       : ${election.id}`);
  console.log(`Name              : ${election.name}`);
  console.log(`Status            : ${election.status}`);
  console.log(`Start Time        : ${election.startTime.toISOString()}`);
  console.log(`End Time          : ${election.endTime.toISOString()}`);
  console.log(`Candidates        : ${election.candidates.map((c) => c.name).join(", ")}`);
  console.log(`Eligible Voters   : ${election.eligibleVoters.map((v) => `${v.email} (${v.studentId})`).join(", ")}`);

  // 6. Test voter eligibility logic (same code as /portal page)
  const eligibility = await checkVoterElectionEligibility({
    userId: voter.id,
    email: voter.email,
    voterId: voter.voterId,
    role: voter.role,
    emailVerified: voter.emailVerified,
    electionId: election.id,
  });

  console.log("\nVoter Portal Eligibility Simulation:");
  console.log(`- Voter Email     : ${targetEmail}`);
  console.log(`- Is Eligible     : ${eligibility.ok}`);
  if (!eligibility.ok) {
    console.error(`- Block Reason    : ${eligibility.reason}`);
    throw new Error("Voter failed eligibility simulation!");
  } else {
    console.log(`- Eligibility     : CONFIRMED ELIGIBLE`);
  }

  console.log("\n==================================================================");
  console.log("✓ SUCCESS: The test election is active and persistent in Neon.");
  console.log("✓ You can now open your browser, log in as 24n236@psgtech.ac.in,");
  console.log("  and cast your vote to test the live Sepolia blockchain path.");
  console.log("==================================================================\n");
}

main()
  .catch((err) => {
    console.error("Setup error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
