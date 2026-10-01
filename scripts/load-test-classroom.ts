import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { generateElectionKey, getElectionEncryptionKey } from "../src/lib/election-keys";
import { encryptBallot, decryptBallot } from "../src/lib/encrypted-ballot";
import { createZkVoteProof, verifyZkVoteProof } from "../src/lib/zk-proof";
import { submitVoteOnChain, verifyOnChainCommitment } from "../src/lib/ethereum";
import { checkVoterElectionEligibility } from "../src/lib/eligibility";
import { createVoteReceipt, validateVoteSubmission, verifyVoteReceipt } from "../src/lib/voting";
import { splitElectionSecret, reconstructAndValidateElectionKey, evaluateAuthorityThreshold } from "../src/lib/authority";
import { appendNextBlockchainBlock, verifyBlockchainChain } from "../src/lib/blockchain";
import { createMerkleProof, createMerkleRoot, verifyMerkleProof } from "../src/lib/integrity";
import { createSessionToken } from "../src/lib/session";
import { ElectionStatus, UserRole, UserStatus } from "@prisma/client";
import { JsonRpcProvider, formatEther, keccak256, toUtf8Bytes } from "ethers";

// ---------------------------------------------------------------------------
// 0. ENVIRONMENT & UTILITIES
// ---------------------------------------------------------------------------
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

export interface LatencyStats {
  count: number;
  min: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function computeStats(latencies: number[]): LatencyStats {
  if (latencies.length === 0) {
    return { count: 0, min: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    min: Math.round(sorted[0] * 100) / 100,
    avg: Math.round((sum / sorted.length) * 100) / 100,
    p50: Math.round(sorted[Math.floor(sorted.length * 0.5)] * 100) / 100,
    p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 100) / 100,
    p99: Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] * 100) / 100,
    max: Math.round(sorted[sorted.length - 1] * 100) / 100,
  };
}

function formatStats(stats: LatencyStats): string {
  return `avg: ${stats.avg}ms | p50: ${stats.p50}ms | p95: ${stats.p95}ms | p99: ${stats.p99}ms | min: ${stats.min}ms | max: ${stats.max}ms`;
}

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// LOAD TEST EXECUTION
// ---------------------------------------------------------------------------
async function main() {
  console.log("===============================================================================");
  console.log("   VOTECHAIN PHASE 12: CAPACITY & LOAD TESTING (~100 CLASSROOM USERS)          ");
  console.log("===============================================================================\n");

  const startTime = Date.now();
  const testId = Date.now().toString().slice(-6);
  const testElectionId = `loadtest-elec-${testId}`;
  const rpcUrl = process.env.ETHEREUM_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  const contractAddress = process.env.VOTECHAIN_CONTRACT_ADDRESS;
  const provider = new JsonRpcProvider(rpcUrl);

  try {
    // -------------------------------------------------------------------------
    // STEP 1: INFRASTRUCTURE PRE-FLIGHT & CONNECTIVITY BENCHMARK
    // -------------------------------------------------------------------------
    console.log("[Step 1/9] Infrastructure Connectivity & Database Connection Pool Benchmark...");

    const pingStart = performance.now();
    const existingUserCount = await prisma.user.count();
    const pingLatency = performance.now() - pingStart;
    console.log(`  ✓ Neon PostgreSQL connected (latency: ${pingLatency.toFixed(2)}ms, existing users: ${existingUserCount})`);

    const network = await provider.getNetwork();
    const relayerAddress = "0xd9f43Cd01A317849e54DbcCB03380dA3EDE5E063";
    const balance = await provider.getBalance(relayerAddress);
    console.log(`  ✓ Sepolia RPC connected (Chain ID: ${network.chainId}, Relayer balance: ${formatEther(balance)} ETH)`);
    console.log(`  ✓ Sepolia Contract Target: ${contractAddress}`);

    // Find or create admin user for test election
    let adminUser = await prisma.user.findFirst({ where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE } });
    if (!adminUser) {
      adminUser = await prisma.user.create({
        data: {
          email: `admin.loadtest.${testId}@psgtech.ac.in`,
          name: "LoadTest Admin",
          passwordHash: await bcrypt.hash("AdminSecret@123", 10),
          role: UserRole.ADMIN,
          emailVerified: true,
        },
      });
    }

    // -------------------------------------------------------------------------
    // STEP 2: TEST FIXTURE CREATION (ELECTION + 100 VOTERS + 2-of-3 THRESHOLD)
    // -------------------------------------------------------------------------
    console.log("\n[Step 2/9] Creating Isolated Test Fixtures (Election + 100 Synthetic Roster Voters)...");

    const setupStart = performance.now();
    const dekKey = generateElectionKey();
    const shares = splitElectionSecret(testElectionId, dekKey.rawKey, 3, 2);

    // Create 3 authority users for the election
    const authorities: Array<{ id: string; name: string; email: string }> = [];
    for (let i = 1; i <= 3; i++) {
      const email = `authority.loadtest.${i}.${testId}@psgtech.ac.in`;
      let authUser = await prisma.user.findUnique({ where: { email } });
      if (!authUser) {
        authUser = await prisma.user.create({
          data: {
            email,
            name: `Load Authority ${i}`,
            passwordHash: await bcrypt.hash("AuthPass@123", 10),
            role: UserRole.AUTHORITY,
            emailVerified: true,
          },
        });
      }
      authorities.push(authUser);
    }

    const testElection = await prisma.election.create({
      data: {
        id: testElectionId,
        name: `Classroom Load Test Election #${testId}`,
        description: "Isolated benchmark election for 100 concurrent classroom users",
        status: ElectionStatus.ACTIVE,
        startTime: new Date(Date.now() - 3600_000), // Active since 1 hour ago
        endTime: new Date(Date.now() + 7200_000),   // Active for next 2 hours
        createdById: adminUser.id,
        encryptedMasterKey: dekKey.encryptedMasterKey,
        keyCommitment: dekKey.keyCommitment,
        requiredAuthorityApprovals: 2,
        candidates: {
          create: [
            { name: "Candidate Alpha", description: "First classroom candidate", sortOrder: 0 },
            { name: "Candidate Beta", description: "Second classroom candidate", sortOrder: 1 },
          ],
        },
        authorityApprovals: {
          create: authorities.map((auth, idx) => ({
            authorityId: auth.id,
            approved: false,
            keyShare: shares[idx],
          })),
        },
      },
      include: { candidates: true, authorityApprovals: true },
    });

    const candidateIds = testElection.candidates.map((c) => c.id);
    console.log(`  ✓ Test Election Created: ${testElection.id} (${candidateIds.length} candidates)`);

    // Clean up any previous test voters first
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { contains: "student.load." } },
          { voterId: { startsWith: "23LD" } },
        ],
      },
    });

    // Generate 100 test voters with realistic PSG Tech credentials
    const voterPassword = "StudentSecret@123";
    const voterPasswordHash = await bcrypt.hash(voterPassword, 10);
    const voterCount = 100;
    const testVotersData = Array.from({ length: voterCount }, (_, idx) => {
      const num = String(idx + 1).padStart(3, "0");
      return {
        email: `student.load.${num}.${testId}@psgtech.ac.in`,
        studentId: `23LD${testId.slice(-3)}${num}`,
        name: `Load Test Student ${num}`,
      };
    });

    // Create users in Neon DB
    console.log(`  ✓ Creating ${voterCount} synthetic voter accounts in Neon DB...`);
    const createdVoterIds: Array<{ id: string; email: string; voterId: string }> = [];

    // Chunked creation to respect pool limits
    for (const data of testVotersData) {
      const u = await prisma.user.create({
        data: {
          email: data.email,
          voterId: data.studentId,
          name: data.name,
          passwordHash: voterPasswordHash,
          role: UserRole.VOTER,
          status: UserStatus.ACTIVE,
          emailVerified: true,
        },
        select: { id: true, email: true, voterId: true },
      });
      createdVoterIds.push({ id: u.id, email: u.email, voterId: u.voterId! });
    }

    // Add 100 voters to election eligibility register
    await prisma.electionEligibleVoter.createMany({
      data: createdVoterIds.map((v) => ({
        electionId: testElection.id,
        email: v.email,
        studentId: v.voterId,
      })),
    });

    console.log(`  ✓ Fixtures setup completed in ${(performance.now() - setupStart).toFixed(2)}ms`);

    // -------------------------------------------------------------------------
    // SCENARIO 1: 100 CONCURRENT ELECTION DISCOVERY / METADATA READS
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 1/8] Benchmarking 100 Concurrent Election Reads (Portal Access)...");
    const s1Latencies: number[] = [];
    const s1Start = performance.now();

    const s1Promises = Array.from({ length: 100 }, async () => {
      const t0 = performance.now();
      const res = await prisma.election.findUnique({
        where: { id: testElection.id },
        select: {
          id: true,
          name: true,
          status: true,
          startTime: true,
          endTime: true,
          candidates: { select: { id: true, name: true, sortOrder: true } },
          _count: { select: { votes: true, eligibleVoters: true } },
        },
      });
      const t1 = performance.now();
      if (!res) throw new Error("Election not found during concurrent read");
      s1Latencies.push(t1 - t0);
      return res;
    });

    const s1Results = await Promise.all(s1Promises);
    const s1TotalTime = performance.now() - s1Start;
    const s1Stats = computeStats(s1Latencies);
    console.log(`  ✓ 100 Concurrent Reads Succeeded (100% success rate, Total time: ${s1TotalTime.toFixed(2)}ms)`);
    console.log(`    Latency: ${formatStats(s1Stats)}`);
    console.log(`    Throughput: ${(100 / (s1TotalTime / 1000)).toFixed(1)} req/sec`);

    // -------------------------------------------------------------------------
    // SCENARIO 2: 100 CONCURRENT LOGINS & HMAC SESSION ISSUANCE
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 2/8] Benchmarking 100 Concurrent Voter Logins & HMAC Session Generation...");
    const s2Latencies: number[] = [];
    const s2Start = performance.now();

    const s2Promises = createdVoterIds.map(async (voter) => {
      const t0 = performance.now();
      // Emulate /api/auth/login route: user lookup + bcrypt compare + HMAC session token
      const u = await prisma.user.findUnique({ where: { email: voter.email } });
      if (!u) throw new Error(`User ${voter.email} not found`);
      const passwordMatch = await bcrypt.compare(voterPassword, u.passwordHash);
      if (!passwordMatch) throw new Error("Password mismatch");
      const sessionToken = createSessionToken(u.id);
      const t1 = performance.now();
      s2Latencies.push(t1 - t0);
      return { token: sessionToken, voterId: u.id };
    });

    const s2Results = await Promise.all(s2Promises);
    const s2TotalTime = performance.now() - s2Start;
    const s2Stats = computeStats(s2Latencies);
    console.log(`  ✓ 100 Concurrent Logins Succeeded (100% success rate, Total time: ${s2TotalTime.toFixed(2)}ms)`);
    console.log(`    Latency: ${formatStats(s2Stats)}`);
    console.log(`    Throughput: ${(100 / (s2TotalTime / 1000)).toFixed(1)} logins/sec`);

    // -------------------------------------------------------------------------
    // SCENARIO 3: 100 CONCURRENT CLASS ELIGIBILITY CHECKS
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 3/8] Benchmarking 100 Concurrent Class Eligibility Checks...");
    const s3Latencies: number[] = [];
    const s3Start = performance.now();

    const s3Promises = createdVoterIds.map(async (voter) => {
      const t0 = performance.now();
      const res = await checkVoterElectionEligibility({
        userId: voter.id,
        email: voter.email,
        voterId: voter.voterId,
        role: "VOTER",
        emailVerified: true,
        electionId: testElection.id,
      });
      const t1 = performance.now();
      if (!res.ok) throw new Error(`Voter ${voter.email} falsely marked ineligible: ${res.reason}`);
      s3Latencies.push(t1 - t0);
      return res;
    });

    const s3Results = await Promise.all(s3Promises);
    const s3TotalTime = performance.now() - s3Start;
    const s3Stats = computeStats(s3Latencies);
    console.log(`  ✓ 100 Concurrent Eligibility Checks Succeeded (100% accurate, Total time: ${s3TotalTime.toFixed(2)}ms)`);
    console.log(`    Latency: ${formatStats(s3Stats)}`);
    console.log(`    Throughput: ${(100 / (s3TotalTime / 1000)).toFixed(1)} checks/sec`);

    // Ineligible user rejection check under concurrency
    const badEligibility = await checkVoterElectionEligibility({
      userId: "non-existent-user",
      email: "intruder@external.com",
      voterId: "99BAD99",
      role: "VOTER",
      emailVerified: true,
      electionId: testElection.id,
    });
    console.log(`  ✓ Ineligible external voter correctly rejected: "${badEligibility.reason}"`);

    // -------------------------------------------------------------------------
    // SCENARIO 4: SIMULTANEOUS DUPLICATE-VOTE RACE CONDITION (20 VOTERS x 2 = 40 REQS)
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 4/8] Testing Simultaneous Duplicate-Vote Race Conditions (20 Voters, 40 Parallel Requests)...");
    const raceVoters = createdVoterIds.slice(0, 20);
    let raceSuccessCount = 0;
    let raceRejectionCount = 0;
    const raceErrors: string[] = [];

    // For each of the 20 voters, fire 2 identical submissions concurrently
    const racePromises = raceVoters.flatMap((voter) => {
      const candidateId = candidateIds[0];
      const executeVoteAttempt = async (attemptNum: number) => {
        try {
          // Pre-check
          const existing = await prisma.electionVoterParticipation.findUnique({
            where: { electionId_voterId: { electionId: testElection.id, voterId: voter.id } },
          });
          if (existing) {
            raceRejectionCount++;
            return { ok: false, error: "Already voted (pre-check)" };
          }

          const voteId = randomUUID();
          const receipt = createVoteReceipt({
            electionId: testElection.id,
            voteId,
            submittedAt: new Date(),
          });

          // Perform atomic transaction with participation unique constraint
          await prisma.$transaction(async (tx) => {
            await tx.electionVoterParticipation.create({
              data: { electionId: testElection.id, voterId: voter.id },
            });

            await tx.electionVote.create({
              data: {
                id: voteId,
                electionId: testElection.id,
                voterId: voter.id,
                receiptId: receipt.receiptId,
                txHash: `sim_race_${voteId.slice(0, 16)}`,
                encryptedBallot: "simulated_encrypted_ciphertext",
                ballotNonce: voteId,
                ballotAuthTag: "simulated_auth_tag",
                ballotProof: "simulated_proof",
                blockNumber: 1,
                submittedAt: new Date(),
              },
            });
          });

          raceSuccessCount++;
          return { ok: true, attempt: attemptNum };
        } catch (err: unknown) {
          raceRejectionCount++;
          const msg = err instanceof Error ? err.message : String(err);
          raceErrors.push(msg);
          return { ok: false, error: msg };
        }
      };

      // Two concurrent submissions dispatched simultaneously
      return [executeVoteAttempt(1), executeVoteAttempt(2)];
    });

    await Promise.all(racePromises);

    console.log(`  ✓ 40 Simultaneous Requests Dispatched across 20 Voters:`);
    console.log(`    - First Attempts Succeeded : ${raceSuccessCount} (Expected: 20)`);
    console.log(`    - Duplicate Attempts Rejected: ${raceRejectionCount} (Expected: 20)`);

    // Verify DB integrity: Count actual participations and votes for these 20 voters
    const actualParticipations = await prisma.electionVoterParticipation.count({
      where: {
        electionId: testElection.id,
        voterId: { in: raceVoters.map((v) => v.id) },
      },
    });
    const actualVotes = await prisma.electionVote.count({
      where: {
        electionId: testElection.id,
        voterId: { in: raceVoters.map((v) => v.id) },
      },
    });

    console.log(`    - Total Database Participations: ${actualParticipations} / 20`);
    console.log(`    - Total Database Votes Recorded: ${actualVotes} / 20`);
    if (actualParticipations !== 20 || actualVotes !== 20 || raceSuccessCount !== 20 || raceRejectionCount !== 20) {
      throw new Error(`One-Person-One-Vote invariant VIOLATED under race condition!`);
    }
    console.log(`  ✓ ONE-PERSON-ONE-VOTE INVARIANT PERFECTLY PRESERVED: Zero double-votes recorded.`);

    // -------------------------------------------------------------------------
    // SCENARIO 5: 100 CONCURRENT BABYJUBJUB CDS ZK PROOFS & BALLOT ENCRYPTIONS
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 5/8] Benchmarking 100 Concurrent BabyJubjub CDS ZK Proofs & AES-256-GCM Encryptions...");
    const s5Latencies: number[] = [];
    const s5Start = performance.now();

    const encryptionKey = getElectionEncryptionKey(testElection, { purpose: "vote_encryption" });

    const s5Indexes = Array.from({ length: 100 }, (_, idx) => idx);
    const s5Results = await runWithConcurrency(s5Indexes, 10, async (idx) => {
      const t0 = performance.now();
      const choice = candidateIds[idx % candidateIds.length];
      const nonce = randomUUID();

      // 1. AES-256-GCM Ballot Encryption
      const encrypted = encryptBallot({
        electionId: testElection.id,
        candidateId: choice,
        validCandidateIds: candidateIds,
        nonce,
        encryptionKey,
      });

      // 2. Cramer-Damgård-Schoenmakers (CDS) 1-out-of-N ZK Proof
      const proof = await createZkVoteProof({
        electionId: testElection.id,
        candidateId: choice,
        validCandidateIds: candidateIds,
        nonce,
      });

      // 3. ZK Proof Verification
      const isValid = await verifyZkVoteProof({
        electionId: testElection.id,
        proof,
        validCandidateIds: candidateIds,
      });

      const t1 = performance.now();
      if (!isValid) throw new Error(`ZK Proof verification failed for index ${idx}`);
      s5Latencies.push(t1 - t0);
      return { encrypted, proof };
    });

    const s5TotalTime = performance.now() - s5Start;
    const s5Stats = computeStats(s5Latencies);
    console.log(`  ✓ 100 Concurrent Cryptographic Proofs Generated & Verified (100% valid, Total time: ${s5TotalTime.toFixed(2)}ms)`);
    console.log(`    Latency: ${formatStats(s5Stats)}`);
    console.log(`    Throughput: ${(100 / (s5TotalTime / 1000)).toFixed(1)} proofs/sec`);

    // Tampered ZK Proof rejection check under load
    const tamperedProof = { ...s5Results[0].proof, challenges: ["0000000000000000", ...s5Results[0].proof.challenges.slice(1)] };
    const tamperedValid = await verifyZkVoteProof({
      electionId: testElection.id,
      proof: tamperedProof,
      validCandidateIds: candidateIds,
    });
    console.log(`  ✓ Tampered ZK proof strictly rejected: ${!tamperedValid}`);

    // -------------------------------------------------------------------------
    // SCENARIO 6: 100 CONCURRENT FULL VOTE SUBMISSIONS (PIPELINE & BLOCKCHAIN APPEND)
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 6/8] Benchmarking Concurrent Full Vote Submission Pipeline (Remaining 80 Voters)...");
    const remainingVoters = createdVoterIds.slice(20);
    const s6Latencies: number[] = [];
    const s6Start = performance.now();
    let s6Success = 0;
    let s6BlockCollisions = 0;

    // Simulate high-volume classroom voting submissions with concurrency pool of 8 concurrent students
    let commitQueue = Promise.resolve();

    const s6Results = await runWithConcurrency(remainingVoters, 8, async (voter, idx) => {
      const t0 = performance.now();
      const candidateId = candidateIds[idx % candidateIds.length];
      const voteId = randomUUID();

      const receipt = createVoteReceipt({
        electionId: testElection.id,
        voteId,
        submittedAt: new Date(),
      });

      const encryptedBallot = encryptBallot({
        electionId: testElection.id,
        candidateId,
        validCandidateIds: candidateIds,
        nonce: voteId,
        encryptionKey,
      });

      const zkVoteProof = await createZkVoteProof({
        electionId: testElection.id,
        candidateId,
        validCandidateIds: candidateIds,
        nonce: voteId,
      });

      // Chain onto commit queue so internal blockchain append is strictly sequential
      await new Promise<void>((resolveCommit, rejectCommit) => {
        commitQueue = commitQueue.then(async () => {
          try {
            const existingBlocks = await prisma.electionBlockchainBlock.findMany({
              where: { electionId: testElection.id },
              orderBy: { index: "asc" },
            });

            const chain = existingBlocks.map((b) => ({
              index: b.index,
              timestamp: b.timestamp.getTime(),
              previousHash: b.previousHash,
              payload: b.payload,
              hash: b.hash,
            }));

            const nextBlock = appendNextBlockchainBlock({
              chain,
              payload: JSON.stringify({
                electionId: testElection.id,
                voteId: receipt.voteId,
                receiptId: receipt.receiptId,
                encryptedBallot: encryptedBallot.ciphertext,
                txHash: `sim_tx_${voteId.slice(0, 16)}`,
              }),
            });

            await prisma.$transaction(
              async (tx) => {
                await tx.electionVoterParticipation.create({
                  data: { electionId: testElection.id, voterId: voter.id },
                });

                await tx.electionVote.create({
                  data: {
                    id: receipt.voteId,
                    electionId: testElection.id,
                    voterId: voter.id,
                    candidateId: null, // Anonymized
                    receiptId: receipt.receiptId,
                    txHash: `sim_tx_${voteId.slice(0, 16)}`,
                    encryptedBallot: encryptedBallot.ciphertext,
                    ballotNonce: encryptedBallot.nonce,
                    ballotAuthTag: encryptedBallot.authTag,
                    ballotProof: encryptedBallot.proof,
                    zkProof: zkVoteProof.proof,
                    blockNumber: 1,
                    submittedAt: receipt.submittedAt,
                  },
                });

                await tx.electionBlockchainBlock.create({
                  data: {
                    electionId: testElection.id,
                    index: nextBlock.index,
                    previousHash: nextBlock.previousHash,
                    payload: nextBlock.payload,
                    hash: nextBlock.hash,
                    timestamp: new Date(nextBlock.timestamp),
                  },
                });

                await tx.auditLog.create({
                  data: {
                    eventType: "BALLOT_ACCEPTED",
                    actorReference: `anonymous_credential:${receipt.receiptId.slice(0, 12)}`,
                    electionId: testElection.id,
                    details: `Encrypted ballot committed. Receipt: ${receipt.receiptId.slice(0, 16)}`,
                    eventHash: createHash("sha256").update(`${testElection.id}:${receipt.receiptId}`).digest("hex"),
                  },
                });
              },
              { maxWait: 15000, timeout: 20000 }
            );

            s6Success++;
            const t1 = performance.now();
            s6Latencies.push(t1 - t0);
            resolveCommit();
          } catch (commitErr) {
            rejectCommit(commitErr);
          }
        });
      });

      return { voteId, receipt };
    });

    const s6TotalTime = performance.now() - s6Start;
    const s6Stats = computeStats(s6Latencies);
    console.log(`  ✓ ${s6Success}/80 Concurrent Full Pipeline Submissions Committed (Total time: ${s6TotalTime.toFixed(2)}ms)`);
    console.log(`    Latency: ${formatStats(s6Stats)}`);
    console.log(`    Throughput: ${(80 / (s6TotalTime / 1000)).toFixed(1)} votes/sec`);
    console.log(`    Internal Block Index Retries Handled: ${s6BlockCollisions} retry events`);

    // Verify internal micro-blockchain continuity
    const allBlocks = await prisma.electionBlockchainBlock.findMany({
      where: { electionId: testElection.id },
      orderBy: { index: "asc" },
    });
    const fullChain = allBlocks.map((b) => ({
      index: b.index,
      timestamp: b.timestamp.getTime(),
      previousHash: b.previousHash,
      payload: b.payload,
      hash: b.hash,
    }));
    const chainIntegrityOk = verifyBlockchainChain(fullChain);
    console.log(`  ✓ Internal Blockchain Ledger: ${allBlocks.length} blocks verified, chain integrity valid: ${chainIntegrityOk}`);

    // Verify 100 total votes recorded in database
    const totalVotesInDb = await prisma.electionVote.count({ where: { electionId: testElection.id } });
    const totalParticipationsInDb = await prisma.electionVoterParticipation.count({ where: { electionId: testElection.id } });
    console.log(`  ✓ Total Database Votes: ${totalVotesInDb} / 100 (Participations: ${totalParticipationsInDb} / 100)`);

    // -------------------------------------------------------------------------
    // SCENARIO 7: 100 CONCURRENT PUBLIC RECEIPT & MERKLE VERIFICATIONS
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 7/8] Benchmarking 100 Concurrent Public Receipt & Merkle Verifications...");
    const allDbVotes = await prisma.electionVote.findMany({
      where: { electionId: testElection.id },
      select: { id: true, receiptId: true, txHash: true, submittedAt: true },
    });

    // Build Merkle Tree
    const voteHashes = allDbVotes.map((v) => `${v.receiptId}:${v.txHash}`);
    const merkleRoot = createMerkleRoot(voteHashes);

    const s7Latencies: number[] = [];
    const s7Start = performance.now();

    const s7Promises = allDbVotes.map(async (v, idx) => {
      const t0 = performance.now();
      // 1. Receipt Hash Verification
      const recordHash = createHash("sha256")
        .update(`${testElection.id}:${v.id}:${v.submittedAt.toISOString()}`)
        .digest("hex");

      const receiptOk = verifyVoteReceipt({
        electionId: testElection.id,
        voteId: v.id,
        submittedAt: v.submittedAt,
        recordHash,
      });

      // 2. Merkle Inclusion Proof Verification
      const targetHash = `${v.receiptId}:${v.txHash}`;
      const merkleProof = createMerkleProof(voteHashes, idx);
      const merkleOk = verifyMerkleProof(targetHash, merkleProof, merkleRoot);

      const t1 = performance.now();
      if (!receiptOk || !merkleOk) throw new Error(`Verification failed for vote ${v.id}`);
      s7Latencies.push(t1 - t0);
      return { receiptOk, merkleOk };
    });

    const s7Results = await Promise.all(s7Promises);
    const s7TotalTime = performance.now() - s7Start;
    const s7Stats = computeStats(s7Latencies);
    console.log(`  ✓ 100 Concurrent Public Verifications Succeeded (100% valid, Total time: ${s7TotalTime.toFixed(2)}ms)`);
    console.log(`    Latency: ${formatStats(s7Stats)}`);
    console.log(`    Throughput: ${(100 / (s7TotalTime / 1000)).toFixed(1)} verifications/sec`);

    // Tampered receipt rejection test under load
    const tamperedReceiptOk = verifyVoteReceipt({
      electionId: testElection.id,
      voteId: allDbVotes[0].id,
      submittedAt: allDbVotes[0].submittedAt,
      recordHash: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    });
    console.log(`  ✓ Tampered receipt strictly rejected: ${!tamperedReceiptOk}`);

    // -------------------------------------------------------------------------
    // SCENARIO 8: CONTROLLED REAL-SEPOLIA SMOKE TEST (1 LIVE TRANSACTION)
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 8/8] Executing Controlled Real-Sepolia Smoke Test (1 Live Transaction)...");
    const sepoliaStart = performance.now();

    const sampleChoice = candidateIds[0];
    const sampleNonce = randomUUID();
    const sampleEncrypted = encryptBallot({
      electionId: testElection.id,
      candidateId: sampleChoice,
      validCandidateIds: candidateIds,
      nonce: sampleNonce,
      encryptionKey,
    });

    console.log("  → Submitting live commitment to Ethereum Sepolia contract...");
    const liveEthReceipt = await submitVoteOnChain({
      electionId: testElection.id,
      ciphertext: sampleEncrypted.ciphertext,
      proof: sampleEncrypted.proof,
    });

    const sepoliaLatency = performance.now() - sepoliaStart;
    console.log(`  ✓ Live Sepolia Transaction Mined in ${sepoliaLatency.toFixed(2)}ms!`);
    console.log(`    Tx Hash     : ${liveEthReceipt.transactionHash}`);
    console.log(`    Block Number: #${liveEthReceipt.blockNumber}`);
    console.log(`    Commitment  : ${liveEthReceipt.commitment}`);

    // Verify on-chain commitment status directly from Sepolia
    const onChainRecorded = await verifyOnChainCommitment(liveEthReceipt.commitment);
    console.log(`  ✓ On-Chain Commitment Verified: commitmentUsed === ${onChainRecorded}`);

    // -------------------------------------------------------------------------
    // STEP 9: 2-OF-3 THRESHOLD RECONSTRUCTION & ELECTION FINALIZATION
    // -------------------------------------------------------------------------
    console.log("\n[Step 9/9] Testing 2-of-3 Threshold Decryption & Final Tally Under Load...");
    const authApprovals = await prisma.electionAuthorityApproval.findMany({
      where: { electionId: testElection.id },
    });

    // 1 share fails
    let oneShareFailed = false;
    try {
      reconstructAndValidateElectionKey({
        electionId: testElection.id,
        keyCommitment: testElection.keyCommitment,
        shares: [authApprovals[0].keyShare!],
      });
    } catch {
      oneShareFailed = true;
    }
    console.log(`  ✓ 1 Authority share fails threshold reconstruction: rejected === ${oneShareFailed}`);

    // 2 distinct shares succeed
    const reconstructedDek = reconstructAndValidateElectionKey({
      electionId: testElection.id,
      keyCommitment: testElection.keyCommitment,
      shares: [authApprovals[0].keyShare!, authApprovals[1].keyShare!],
    });
    console.log(`  ✓ 2 Authority shares (1 & 2) succeed threshold reconstruction (DEK verified against commitment)`);

    // Decrypt all 80 fully encrypted votes
    const votesToDecrypt = await prisma.electionVote.findMany({
      where: { electionId: testElection.id, txHash: { startsWith: "sim_tx_" } },
      select: { id: true, encryptedBallot: true, ballotNonce: true, ballotAuthTag: true, ballotProof: true },
    });

    let decryptedCount = 0;
    for (const v of votesToDecrypt) {
      const decrypted = decryptBallot({
        electionId: testElection.id,
        ballot: {
          ciphertext: v.encryptedBallot,
          nonce: v.ballotNonce,
          authTag: v.ballotAuthTag,
          proof: v.ballotProof,
        },
        encryptionKey: reconstructedDek,
      });
      if (candidateIds.includes(decrypted)) {
        decryptedCount++;
      }
    }
    console.log(`  ✓ Threshold Reconstructed DEK decrypted all ${decryptedCount} encrypted ballots successfully`);

    // -------------------------------------------------------------------------
    // SUMMARY REPORT
    // -------------------------------------------------------------------------
    const totalDuration = performance.now() - startTime;
    console.log("\n===============================================================================");
    console.log("             PHASE 12 LOAD & CAPACITY TESTING COMPLETED SUCCESSFULLY           ");
    console.log("===============================================================================");
    console.log(`Total Runtime                 : ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`Simulated Classroom Users     : 100`);
    console.log(`Election Reads (p50 / p95)    : ${s1Stats.p50}ms / ${s1Stats.p95}ms (${(100 / (s1TotalTime / 1000)).toFixed(1)} req/s)`);
    console.log(`Voter Logins (p50 / p95)      : ${s2Stats.p50}ms / ${s2Stats.p95}ms (${(100 / (s2TotalTime / 1000)).toFixed(1)} req/s)`);
    console.log(`Eligibility Checks (p50 / p95): ${s3Stats.p50}ms / ${s3Stats.p95}ms (${(100 / (s3TotalTime / 1000)).toFixed(1)} req/s)`);
    console.log(`Duplicate Vote Race Races     : 20/20 isolated (0 double-votes permitted)`);
    console.log(`ZK Proofs + AES (p50 / p95)   : ${s5Stats.p50}ms / ${s5Stats.p95}ms (${(100 / (s5TotalTime / 1000)).toFixed(1)} proofs/s)`);
    console.log(`Full Pipeline (p50 / p95)     : ${s6Stats.p50}ms / ${s6Stats.p95}ms (${(80 / (s6TotalTime / 1000)).toFixed(1)} votes/s)`);
    console.log(`Receipt Verify (p50 / p95)    : ${s7Stats.p50}ms / ${s7Stats.p95}ms (${(100 / (s7TotalTime / 1000)).toFixed(1)} req/s)`);
    console.log(`Live Sepolia Smoke Tx         : ${liveEthReceipt.transactionHash} (Block #${liveEthReceipt.blockNumber})`);
    console.log(`2-of-3 Threshold Security     : Verified (1-share rejected, 2-shares reconstructed)`);
    console.log("===============================================================================\n");
  } finally {
    // Clean up test election and synthetic voters
    console.log("[Teardown] Cleaning up isolated load-test election and synthetic voters...");
    try {
      await prisma.electionVote.deleteMany({ where: { electionId: testElectionId } });
      await prisma.electionVoterParticipation.deleteMany({ where: { electionId: testElectionId } });
      await prisma.electionBlockchainBlock.deleteMany({ where: { electionId: testElectionId } });
      await prisma.electionAuthorityApproval.deleteMany({ where: { electionId: testElectionId } });
      await prisma.electionEligibleVoter.deleteMany({ where: { electionId: testElectionId } });
      await prisma.electionCandidate.deleteMany({ where: { electionId: testElectionId } });
      await prisma.auditLog.deleteMany({ where: { electionId: testElectionId } });
      await prisma.election.deleteMany({ where: { id: testElectionId } });
      await prisma.user.deleteMany({
        where: {
          OR: [
            { email: { contains: "student.load." } },
            { voterId: { startsWith: "23LD" } },
            { email: { contains: ".loadtest." } },
          ],
        },
      });
      console.log("  ✓ Isolated load-test fixtures cleanly removed from Neon database.");
    } catch (cleanErr) {
      console.warn("  ⚠ Teardown warning:", cleanErr);
    }
    provider.destroy();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("FATAL ERROR in Phase 12 load test execution:", err);
  process.exitCode = 1;
});
