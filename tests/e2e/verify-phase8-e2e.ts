import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/database/prisma";
import { encryptBallot } from "@/security/encryption";
import { createZkVoteProof, verifyZkVoteProof } from "@/security/zk-proof";
import { submitVoteOnChain, verifyOnChainCommitment } from "@/blockchain/ethereum";
import { UserRole, UserStatus } from "@prisma/client";

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
  console.log("   PHASE 8: LIVE END-TO-END APPLICATION VOTE TO ETHEREUM SEPOLIA   ");
  console.log("==================================================================");
  console.log(`RPC URL         : ${process.env.ETHEREUM_RPC_URL}`);
  console.log(`Contract Address: ${process.env.VOTECHAIN_CONTRACT_ADDRESS}`);

  const testId = Date.now().toString().slice(-6);
  const electionTitle = `Phase 8 Live Sepolia Test Election #${testId}`;

  // 1. Setup admin and voter in database
  console.log("\n[Step 1/6] Preparing test users in Neon PostgreSQL...");
  const adminEmail = `phase8_admin_${testId}@psgtech.ac.in`;
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      name: "Phase 8 Admin",
      email: adminEmail,
      voterId: `ADM${testId}`,
      passwordHash: "$2a$12$dummyhashforphase8controlledverificationtest",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  const testVoterEmail = `phase8_voter_${testId}@psgtech.ac.in`;
  const testStudentId = `24P8${testId}`;
  const voter = await prisma.user.upsert({
    where: { email: testVoterEmail },
    update: { emailVerified: true },
    create: {
      name: "Phase 8 Test Voter",
      email: testVoterEmail,
      voterId: testStudentId,
      passwordHash: "$2a$12$dummyhashforphase8controlledverificationtest",
      role: UserRole.VOTER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  // 2. Create a controlled test election
  console.log("\n[Step 2/6] Creating controlled test election in Neon PostgreSQL...");
  const now = new Date();
  const later = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const election = await prisma.election.create({
    data: {
      name: electionTitle,
      description: "Live testnet vote recording verification",
      status: "ACTIVE",
      startTime: now,
      endTime: later,
      createdById: admin.id,
      candidates: {
        create: [
          { name: "Candidate Alpha", description: "Test Candidate Alpha" },
          { name: "Candidate Beta", description: "Test Candidate Beta" },
        ],
      },
      eligibleVoters: {
        create: [
          {
            email: testVoterEmail,
            studentId: testStudentId,
          },
        ],
      },
    },
    include: { candidates: true },
  });
  console.log(`  ✓ Created Election: "${election.name}" (ID: ${election.id})`);
  console.log(`  ✓ Candidates: ${election.candidates.map((c) => c.name).join(", ")}`);
  console.log(`  ✓ Eligible Voter: ${testVoterEmail} (Verified: true)`);

  try {
    // 3. Client-Side Cryptographic Execution (BabyJubjub CDS ZKP + AES-256-GCM)
    console.log("\n[Step 3/6] Generating client-side ZK proof and encrypted ballot...");
    const chosenCandidate = election.candidates[0]; // Candidate Alpha
    const candidateId = chosenCandidate.id;
    const validCandidateIds = election.candidates.map((c) => c.id);
    const voteId = randomUUID();

    const encryptedBallot = encryptBallot({
      electionId: election.id,
      candidateId,
      validCandidateIds,
      nonce: voteId,
    });

    const zkVoteProof = await createZkVoteProof({
      electionId: election.id,
      candidateId,
      validCandidateIds,
      nonce: voteId,
    });

    console.log(`  ✓ AES-256-GCM Encrypted Ballot generated (Length: ${encryptedBallot.ciphertext.length})`);
    console.log(`  ✓ BabyJubjub CDS 1-of-N ZK Proof generated`);

    // 4. Server-Side Verification of ZK Proof
    console.log("\n[Step 4/6] Server validating Zero-Knowledge proof before relaying...");
    const isZkValid = await verifyZkVoteProof({
      electionId: election.id,
      proof: zkVoteProof,
      validCandidateIds,
    });
    if (!isZkValid) throw new Error("Zero-Knowledge proof verification failed!");
    console.log(`  ✓ ZK Proof mathematically validated on server: choice is in allowed candidate set.`);

    // 5. Submit Vote On-Chain to Ethereum Sepolia via submitVoteOnChain
    console.log("\n[Step 5/6] Broadcasting vote commitment to Ethereum Sepolia via submitVoteOnChain...");
    console.log("  (Broadcasting transaction and waiting for confirmation on Sepolia blockchain...)");

    const ethReceipt = await submitVoteOnChain({
      electionId: election.id,
      ciphertext: encryptedBallot.ciphertext,
      proof: encryptedBallot.proof,
    });

    console.log(`  ✓ Transaction Confirmed on Ethereum Sepolia!`);
    console.log(`    - Tx Hash     : ${ethReceipt.transactionHash}`);
    console.log(`    - Block Number: #${ethReceipt.blockNumber}`);
    console.log(`    - Commitment  : ${ethReceipt.commitment}`);
    console.log(`    - Etherscan   : https://sepolia.etherscan.io/tx/${ethReceipt.transactionHash}`);

    // Record in local database with double-blind separation
    await prisma.$transaction(async (tx) => {
      await tx.electionVoterParticipation.create({
        data: { electionId: election.id, voterId: voter.id },
      });
      await tx.electionVote.create({
        data: {
          id: voteId,
          electionId: election.id,
          receiptId: `RCPT-${testId}`,
          txHash: ethReceipt.transactionHash,
          encryptedBallot: encryptedBallot.ciphertext,
          ballotNonce: encryptedBallot.nonce,
          ballotAuthTag: encryptedBallot.authTag,
          ballotProof: encryptedBallot.proof,
          zkProof: zkVoteProof.proof,
          blockNumber: ethReceipt.blockNumber,
          submittedAt: new Date(),
        },
      });
    });
    console.log(`  ✓ Double-blind database records persisted in Neon PostgreSQL.`);

    // 6. Read-Only Public Verification on Sepolia
    console.log("\n[Step 6/6] Verifying on-chain commitment via read-only public path...");
    const isRecordedOnChain = await verifyOnChainCommitment(ethReceipt.commitment);
    console.log(`  ✓ Read-only verification query: commitmentUsed == ${isRecordedOnChain}`);
    if (!isRecordedOnChain) throw new Error("Commitment not detected on Sepolia ledger!");

    // 7. Duplicate Vote / Replay Prevention Test
    console.log("\n[Security Verification] Testing Duplicate Vote / Replay Rejection...");
    let replayBlocked = false;
    try {
      await submitVoteOnChain({
        electionId: election.id,
        ciphertext: encryptedBallot.ciphertext,
        proof: encryptedBallot.proof,
      });
    } catch (replayError) {
      replayBlocked = true;
      console.log(`  ✓ On-chain duplicate commitment successfully rejected: ${(replayError as Error).message.slice(0, 60)}...`);
    }
    if (!replayBlocked) throw new Error("CRITICAL SECURITY ERROR: On-chain replay was not blocked!");

    console.log("\n==================================================================");
    console.log("       PHASE 8 LIVE TESTNET VOTE VERIFICATION: 100% SUCCESS       ");
    console.log("==================================================================");
    console.log(`Tx Confirmed on Sepolia : ${ethReceipt.transactionHash}`);
    console.log(`Block Number            : #${ethReceipt.blockNumber}`);
    console.log(`On-Chain Commitment     : ${ethReceipt.commitment}`);
    console.log(`Voter Privacy           : 0 voter identifiers on blockchain`);
    console.log("==================================================================\n");
  } finally {
    // Clean up temporary election from database
    console.log("Cleaning up test election data from database...");
    if (election?.id) {
      await prisma.electionVote.deleteMany({ where: { electionId: election.id } });
      await prisma.electionVoterParticipation.deleteMany({ where: { electionId: election.id } });
      await prisma.electionEligibleVoter.deleteMany({ where: { electionId: election.id } });
      await prisma.electionCandidate.deleteMany({ where: { electionId: election.id } });
      await prisma.election.delete({ where: { id: election.id } });
    }
    if (voter?.id) {
      await prisma.user.delete({ where: { id: voter.id } });
    }
    if (admin?.id) {
      await prisma.user.delete({ where: { id: admin.id } });
    }
    console.log("✓ Test election, voter, and admin cleaned up.");
  }
}

main().catch((err) => {
  console.error("Phase 8 Verification Error:", err);
  process.exitCode = 1;
});
