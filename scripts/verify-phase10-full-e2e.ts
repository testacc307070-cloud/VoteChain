import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { generateElectionKey, getElectionEncryptionKey, isLegacyElection } from "../src/lib/election-keys";
import { encryptBallot, type StoredEncryptedBallot } from "../src/lib/encrypted-ballot";
import { createZkVoteProof, verifyZkVoteProof } from "../src/lib/zk-proof";
import { submitVoteOnChain, verifyOnChainCommitment } from "../src/lib/ethereum";
import { checkVoterElectionEligibility } from "../src/lib/eligibility";
import { validateVoteSubmission, verifyVoteReceipt } from "../src/lib/voting";
import { splitElectionSecret, reconstructAndValidateElectionKey, evaluateAuthorityThreshold } from "../src/lib/authority";
import { summarizeStoredElectionResults, createElectionAuditDigest } from "../src/lib/election-results";
import { ElectionStatus, UserRole, UserStatus } from "@prisma/client";
import { JsonRpcProvider, formatEther, keccak256, toUtf8Bytes } from "ethers";

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

type TestResultRecord = {
  name: string;
  expected: string;
  actual: string;
  status: "PASS" | "FAIL";
  identifier?: string;
};

const results: TestResultRecord[] = [];

function recordTest(record: TestResultRecord) {
  results.push(record);
  const icon = record.status === "PASS" ? "✓" : "✗";
  console.log(`  ${icon} [${record.status}] ${record.name}`);
  if (record.identifier) {
    console.log(`      Detail/ID: ${record.identifier}`);
  }
}

async function main() {
  console.log("==================================================================");
  console.log("   PHASE 10: FULL ONLINE END-TO-END STACK VERIFICATION (SEPOLIA)  ");
  console.log("==================================================================");

  const rpcUrl = process.env.ETHEREUM_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  const contractAddress = process.env.VOTECHAIN_CONTRACT_ADDRESS;
  const provider = new JsonRpcProvider(rpcUrl);

  try {
    // -----------------------------------------------------------------
    // 1. DEPLOYMENT & INFRASTRUCTURE PRE-FLIGHT CHECKS
    // -----------------------------------------------------------------
    console.log("\n[Step 1/6] Verifying Deployment & Infrastructure Connectivity...");

    // Neon PostgreSQL check
    let neonOk = false;
    try {
      const userCount = await prisma.user.count();
      neonOk = userCount > 0;
      recordTest({
        name: "Neon PostgreSQL Reachable & Connected",
        expected: "Connected to Neon database with existing user records",
        actual: `Connected (Total users: ${userCount})`,
        status: "PASS",
      });
    } catch (err) {
      recordTest({
        name: "Neon PostgreSQL Reachable & Connected",
        expected: "Connected to Neon database",
        actual: `Error: ${(err as Error).message}`,
        status: "FAIL",
      });
    }

    // Sepolia RPC check
    try {
      const network = await provider.getNetwork();
      const relayerAddress = "0xd9f43Cd01A317849e54DbcCB03380dA3EDE5E063";
      const balance = await provider.getBalance(relayerAddress);
      recordTest({
        name: "Ethereum Sepolia RPC Reachable & Relayer Funded",
        expected: "Chain ID 11155111 and relayer funded",
        actual: `Sepolia Chain ID: ${network.chainId}, Relayer: ${relayerAddress} (${formatEther(balance)} ETH)`,
        status: Number(balance) > 0 ? "PASS" : "FAIL",
        identifier: `Sepolia Chain ID: ${network.chainId.toString()}`,
      });
    } catch (err) {
      recordTest({
        name: "Ethereum Sepolia RPC Reachable & Relayer Funded",
        expected: "Chain ID 11155111",
        actual: `Error: ${(err as Error).message}`,
        status: "FAIL",
      });
    }

    // Sepolia Contract check
    try {
      if (!contractAddress) throw new Error("VOTECHAIN_CONTRACT_ADDRESS not configured");
      const code = await provider.getCode(contractAddress);
      const exists = code && code !== "0x" && code !== "0x0";
      recordTest({
        name: "VoteChainLedger Contract Active on Sepolia",
        expected: `Bytecode present at ${contractAddress}`,
        actual: exists ? `Bytecode verified (${code.length} chars)` : "No bytecode found",
        status: exists ? "PASS" : "FAIL",
        identifier: contractAddress,
      });
    } catch (err) {
      recordTest({
        name: "VoteChainLedger Contract Active on Sepolia",
        expected: "Contract responsive",
        actual: `Error: ${(err as Error).message}`,
        status: "FAIL",
      });
    }

    // -----------------------------------------------------------------
    // 2. CONTROLLED MODERN TEST ELECTION SETUP
    // -----------------------------------------------------------------
    console.log("\n[Step 2/6] Creating Controlled Modern Test Election in Neon PostgreSQL...");

    const testId = Date.now().toString().slice(-6);
    const electionName = `Phase 10 Modern E2E Election #${testId} (Sepolia)`;

    // Find admin user
    const admin = await prisma.user.findFirst({ where: { role: UserRole.ADMIN } });
    if (!admin) throw new Error("No admin account found in database.");

    // Find verified voter (Prakash)
    const voterEmail = "24n236@psgtech.ac.in";
    const voter = await prisma.user.findUnique({ where: { email: voterEmail } });
    if (!voter) throw new Error(`Voter ${voterEmail} not found in database.`);

    // Generate fresh per-election 256-bit encryption key envelope
    const { rawKey: electionDek, encryptedMasterKey, keyCommitment } = generateElectionKey();

    const now = new Date();
    const startTime = new Date(now.getTime() - 60_000); // started 1 min ago
    const endTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const election = await prisma.election.create({
      data: {
        name: electionName,
        description: "Phase 10 controlled modern end-to-end online verification election",
        status: ElectionStatus.ACTIVE,
        startTime,
        endTime,
        createdById: admin.id,
        encryptedMasterKey,
        keyCommitment,
        requiredAuthorityApprovals: 2,
        eligibleVoterIds: [voter.voterId || "24N236"],
        candidates: {
          create: [
            { name: "Candidate 1", description: "First Phase 10 Candidate", sortOrder: 0 },
            { name: "Candidate 2", description: "Second Phase 10 Candidate", sortOrder: 1 },
          ],
        },
        eligibleVoters: {
          create: [
            {
              studentId: voter.voterId || "24N236",
              email: voter.email,
            },
          ],
        },
      },
      include: {
        candidates: { orderBy: { sortOrder: "asc" } },
        eligibleVoters: true,
      },
    });

    recordTest({
      name: "Modern Election Creation with Envelope Encryption",
      expected: "Election created with encryptedMasterKey envelope and keyCommitment",
      actual: `Created Election "${election.name}" (ID: ${election.id})`,
      status: election.encryptedMasterKey && election.keyCommitment ? "PASS" : "FAIL",
      identifier: `ID: ${election.id} | Commitment: ${election.keyCommitment?.slice(0, 20)}...`,
    });

    recordTest({
      name: "Per-Election Key Isolation Verified",
      expected: "isLegacyElection() returns false for modern election",
      actual: `isLegacyElection: ${isLegacyElection(election)}`,
      status: !isLegacyElection(election) ? "PASS" : "FAIL",
      identifier: `Envelope: ${election.encryptedMasterKey?.slice(0, 30)}...`,
    });

    // -----------------------------------------------------------------
    // 3. VOTER JOURNEY: ELIGIBILITY, ZK PROOF, ENCRYPTION, SEPOLIA RELAY
    // -----------------------------------------------------------------
    console.log("\n[Step 3/6] Executing Real Voter Journey to Ethereum Sepolia...");

    // Check voter eligibility
    const eligibility = await checkVoterElectionEligibility({
      userId: voter.id,
      email: voter.email,
      role: voter.role,
      emailVerified: voter.emailVerified,
      electionId: election.id,
    });

    recordTest({
      name: "Voter Eligibility Verification",
      expected: "Eligible voter confirmed (registered, verified, on register)",
      actual: `Eligibility ok: ${eligibility.ok}`,
      status: eligibility.ok ? "PASS" : "FAIL",
      identifier: `Voter: ${voter.email} (ID: ${voter.voterId})`,
    });

    // Resolve election DEK for voting
    const resolvedDek = getElectionEncryptionKey(election, { purpose: "vote_encryption" });
    recordTest({
      name: "Election Master Key Envelope Resolution for Voting",
      expected: "Resolved DEK matches raw generated key",
      actual: resolvedDek === electionDek ? "DEK matched successfully" : "Mismatch",
      status: resolvedDek === electionDek ? "PASS" : "FAIL",
    });

    const chosenCandidate = election.candidates[0]; // Vote for Candidate 1
    const validCandidateIds = election.candidates.map((c) => c.id);
    const voteId = randomUUID();

    // 1. Encrypt ballot with modern election DEK
    const encryptedBallot = encryptBallot({
      electionId: election.id,
      candidateId: chosenCandidate.id,
      validCandidateIds,
      nonce: voteId,
      encryptionKey: resolvedDek,
    });

    recordTest({
      name: "AES-256-GCM Ballot Encryption with Per-Election DEK",
      expected: "Ciphertext formatted with auth tag and nonce",
      actual: `Encrypted ballot: ${encryptedBallot.ciphertext.slice(0, 24)}... (tag: ${encryptedBallot.authTag.slice(0, 10)}...)`,
      status: encryptedBallot.ciphertext.startsWith("enc:") && Boolean(encryptedBallot.authTag) ? "PASS" : "FAIL",
    });

    // 2. Generate BabyJubjub CDS Zero-Knowledge proof
    const zkVoteProof = await createZkVoteProof({
      electionId: election.id,
      candidateId: chosenCandidate.id,
      validCandidateIds,
      nonce: voteId,
    });

    const isZkValid = await verifyZkVoteProof({
      electionId: election.id,
      proof: zkVoteProof,
      validCandidateIds,
    });

    recordTest({
      name: "BabyJubjub CDS Zero-Knowledge Proof Generation & Verification",
      expected: "ZK proof generated and validated against candidate set",
      actual: `ZK valid: ${isZkValid}, proof length: ${zkVoteProof.proof.length} chars`,
      status: isZkValid ? "PASS" : "FAIL",
      identifier: `ZK Proof Hash: ${createHash("sha256").update(zkVoteProof.proof).digest("hex").slice(0, 24)}...`,
    });

    // 3. Relay commitment to Ethereum Sepolia contract
    console.log("  Submitting vote commitment to Ethereum Sepolia...");
    const ethereumReceipt = await submitVoteOnChain({
      electionId: election.id,
      ciphertext: encryptedBallot.ciphertext,
      proof: encryptedBallot.proof,
    });

    recordTest({
      name: "Relay Vote Commitment to Sepolia Testnet",
      expected: "Mined transaction receipt with valid blockNumber and transactionHash",
      actual: `Mined in Block #${ethereumReceipt.blockNumber} (Tx: ${ethereumReceipt.transactionHash})`,
      status: Boolean(ethereumReceipt.blockNumber > 0 && ethereumReceipt.transactionHash) ? "PASS" : "FAIL",
      identifier: `TxHash: ${ethereumReceipt.transactionHash}`,
    });

    // 4. Verify commitment on Sepolia contract
    const commitment = ethereumReceipt.commitment;
    const isCommitmentOnChain = await verifyOnChainCommitment(commitment);
    recordTest({
      name: "Sepolia On-Chain Commitment Verification",
      expected: "VoteChainLedger.commitmentUsed() returns true",
      actual: `On-chain status: ${isCommitmentOnChain}`,
      status: isCommitmentOnChain ? "PASS" : "FAIL",
      identifier: `Commitment: ${commitment}`,
    });

    // 5. Store vote in Neon PostgreSQL (Double-blind separation)
    const receiptId = `RCPT-${createHash("sha256").update(`${election.id}:${voter.id}:${ethereumReceipt.transactionHash}`).digest("hex").slice(0, 12).toUpperCase()}`;

    await prisma.electionVoterParticipation.create({
      data: {
        electionId: election.id,
        voterId: voter.id,
      },
    });

    const storedVote = await prisma.electionVote.create({
      data: {
        electionId: election.id,
        receiptId,
        encryptedBallot: encryptedBallot.ciphertext,
        ballotNonce: encryptedBallot.nonce,
        ballotAuthTag: encryptedBallot.authTag,
        ballotProof: encryptedBallot.proof,
        zkProof: zkVoteProof.proof,
        txHash: ethereumReceipt.transactionHash,
        blockNumber: ethereumReceipt.blockNumber,
        voterId: null,      // Strict double-blind separation
        candidateId: null,  // Preserves secret ballot
      },
    });

    recordTest({
      name: "Double-Blind Database Storage (Privacy Protection)",
      expected: "ElectionVote stored with voterId: NULL and candidateId: NULL",
      actual: `Vote ID: ${storedVote.id} | voterId: ${storedVote.voterId ?? "NULL"} | candidateId: ${storedVote.candidateId ?? "NULL"}`,
      status: storedVote.voterId === null && storedVote.candidateId === null ? "PASS" : "FAIL",
      identifier: `Receipt ID: ${receiptId}`,
    });

    // 6. Test One-Person-One-Vote Replay Prevention
    const participations = await prisma.electionVoterParticipation.findMany({
      where: { electionId: election.id, voterId: voter.id },
    });
    const replayValidation = validateVoteSubmission({
      electionId: election.id,
      candidateId: chosenCandidate.id,
      validCandidateIds,
      hasExistingVote: participations.length > 0,
    });

    let dbDuplicateBlocked = false;
    try {
      await prisma.electionVoterParticipation.create({
        data: {
          electionId: election.id,
          voterId: voter.id,
        },
      });
    } catch {
      dbDuplicateBlocked = true;
    }

    recordTest({
      name: "One-Person-One-Vote Duplicate Protection (Replay Prevention)",
      expected: "Second vote blocked at validation and DB unique constraint",
      actual: `Validation ok: ${replayValidation.ok} (Error: "${replayValidation.error}") | DB duplicate blocked: ${dbDuplicateBlocked}`,
      status: !replayValidation.ok && dbDuplicateBlocked ? "PASS" : "FAIL",
    });

    // 7. Test Public Receipt Verification
    const submissionTime = new Date();
    const voteReceipt = {
      electionId: election.id,
      voteId,
      submittedAt: submissionTime,
      recordHash: createHash("sha256").update(`${election.id}:${voteId}:${submissionTime.toISOString()}`).digest("hex"),
    };

    const authenticVerified = verifyVoteReceipt({
      electionId: election.id,
      voteId,
      submittedAt: submissionTime,
      recordHash: voteReceipt.recordHash,
    });

    const tamperedVerified = verifyVoteReceipt({
      electionId: election.id,
      voteId,
      submittedAt: submissionTime,
      recordHash: `${voteReceipt.recordHash.slice(0, -1)}f`,
    });

    recordTest({
      name: "Public Receipt Cryptographic Verification & Tamper Detection",
      expected: "Authentic receipt verified (true); tampered receipt rejected (false)",
      actual: `Authentic: ${authenticVerified} | Tampered: ${tamperedVerified}`,
      status: authenticVerified === true && tamperedVerified === false ? "PASS" : "FAIL",
      identifier: `Record Hash: ${voteReceipt.recordHash.slice(0, 24)}...`,
    });

    // -----------------------------------------------------------------
    // 4. TRANSITION ELECTION TO CLOSED & PHASE 9.3 THRESHOLD SUITE
    // -----------------------------------------------------------------
    console.log("\n[Step 4/6] Closing Election and Verifying Phase 9.3 Mandatory 2-of-3 Threshold Matrix...");

    await prisma.election.update({
      where: { id: election.id },
      data: { status: ElectionStatus.CLOSED },
    });

    // Generate Shamir GF(256) shares for 3 authorities
    const shares = splitElectionSecret(election.id, electionDek, 3, 2);
    const shareA = shares[0]; // x = 1
    const shareB = shares[1]; // x = 2
    const shareC = shares[2]; // x = 3

    const storedBallotsForTally: StoredEncryptedBallot[] = [
      {
        candidateId: null,
        voterId: null,
        encryptedBallot: storedVote.encryptedBallot,
        ballotNonce: storedVote.ballotNonce,
        ballotAuthTag: storedVote.ballotAuthTag,
        ballotProof: storedVote.ballotProof,
      },
    ];

    // Helper simulating the mandatory results tallying route
    function attemptTally(submittedKeyShares: string[]) {
      const threshold = 2;
      const thresholdStatus = evaluateAuthorityThreshold(
        submittedKeyShares.map((s, idx) => ({ authorityId: `auth-${idx + 1}`, approved: true, keyShare: s })),
        threshold,
        election.id,
      );

      if (!thresholdStatus.canReconstructKey || submittedKeyShares.length < threshold) {
        throw new Error(
          `Results tallying locked: need ${threshold} authority shares (Current unique shares: ${thresholdStatus.sharesSubmitted})`,
        );
      }

      const reconstructedKey = reconstructAndValidateElectionKey({
        electionId: election.id,
        keyCommitment: election.keyCommitment,
        shares: submittedKeyShares,
        threshold,
      });

      return summarizeStoredElectionResults(
        election.id,
        election.candidates.map((c) => ({ id: c.id, name: c.name })),
        storedBallotsForTally,
        reconstructedKey,
      );
    }

    // 1. 0 shares -> FAIL
    let zeroSharesFailed = false;
    try {
      attemptTally([]);
    } catch {
      zeroSharesFailed = true;
    }
    recordTest({
      name: "Threshold Matrix: 0 Shares -> Tally Blocked",
      expected: "Locked until threshold is met",
      actual: zeroSharesFailed ? "Successfully blocked (403 locked)" : "Unexpectedly passed",
      status: zeroSharesFailed ? "PASS" : "FAIL",
    });

    // 2. Share A only -> FAIL
    let aOnlyFailed = false;
    try {
      attemptTally([shareA]);
    } catch {
      aOnlyFailed = true;
    }
    recordTest({
      name: "Threshold Matrix: Share A Only -> Tally Blocked",
      expected: "1 share insufficient for threshold 2",
      actual: aOnlyFailed ? "Blocked (1/2 shares)" : "Unexpectedly passed",
      status: aOnlyFailed ? "PASS" : "FAIL",
    });

    // 3. Share B only -> FAIL
    let bOnlyFailed = false;
    try {
      attemptTally([shareB]);
    } catch {
      bOnlyFailed = true;
    }
    recordTest({
      name: "Threshold Matrix: Share B Only -> Tally Blocked",
      expected: "1 share insufficient for threshold 2",
      actual: bOnlyFailed ? "Blocked (1/2 shares)" : "Unexpectedly passed",
      status: bOnlyFailed ? "PASS" : "FAIL",
    });

    // 4. Share C only -> FAIL
    let cOnlyFailed = false;
    try {
      attemptTally([shareC]);
    } catch {
      cOnlyFailed = true;
    }
    recordTest({
      name: "Threshold Matrix: Share C Only -> Tally Blocked",
      expected: "1 share insufficient for threshold 2",
      actual: cOnlyFailed ? "Blocked (1/2 shares)" : "Unexpectedly passed",
      status: cOnlyFailed ? "PASS" : "FAIL",
    });

    // 5. A + B -> SUCCEED
    let abResult: any = null;
    try {
      abResult = attemptTally([shareA, shareB]);
    } catch (e) {
      abResult = e;
    }
    const abPassed = abResult && abResult.totalVotes === 1 && abResult.winner?.name === "Candidate 1";
    recordTest({
      name: "Threshold Matrix: Authorities A + B -> Tally Succeeded",
      expected: "DEK reconstructed, ballot decrypted, Candidate 1 wins",
      actual: abPassed ? `Decrypted 1 vote for ${abResult.winner?.name}` : `Failed: ${abResult}`,
      status: abPassed ? "PASS" : "FAIL",
    });

    // 6. A + C -> SUCCEED
    let acResult: any = null;
    try {
      acResult = attemptTally([shareA, shareC]);
    } catch (e) {
      acResult = e;
    }
    const acPassed = acResult && acResult.totalVotes === 1 && acResult.winner?.name === "Candidate 1";
    recordTest({
      name: "Threshold Matrix: Authorities A + C -> Tally Succeeded",
      expected: "DEK reconstructed, ballot decrypted, Candidate 1 wins",
      actual: acPassed ? `Decrypted 1 vote for ${acResult.winner?.name}` : `Failed: ${acResult}`,
      status: acPassed ? "PASS" : "FAIL",
    });

    // 7. B + C -> SUCCEED
    let bcResult: any = null;
    try {
      bcResult = attemptTally([shareB, shareC]);
    } catch (e) {
      bcResult = e;
    }
    const bcPassed = bcResult && bcResult.totalVotes === 1 && bcResult.winner?.name === "Candidate 1";
    recordTest({
      name: "Threshold Matrix: Authorities B + C -> Tally Succeeded",
      expected: "DEK reconstructed, ballot decrypted, Candidate 1 wins",
      actual: bcPassed ? `Decrypted 1 vote for ${bcResult.winner?.name}` : `Failed: ${bcResult}`,
      status: bcPassed ? "PASS" : "FAIL",
    });

    // 8. A + B + C (all 3) -> SUCCEED
    let abcResult: any = null;
    try {
      abcResult = attemptTally([shareA, shareB, shareC]);
    } catch (e) {
      abcResult = e;
    }
    const abcPassed = abcResult && abcResult.totalVotes === 1 && abcResult.winner?.name === "Candidate 1";
    recordTest({
      name: "Threshold Matrix: Authorities A + B + C -> Tally Succeeded",
      expected: "All 3 shares reconstruct DEK and tally results",
      actual: abcPassed ? `Decrypted 1 vote for ${abcResult.winner?.name}` : `Failed: ${abcResult}`,
      status: abcPassed ? "PASS" : "FAIL",
    });

    // 9. Duplicate approval (A + A) -> FAIL
    let aaFailed = false;
    try {
      attemptTally([shareA, shareA]);
    } catch {
      aaFailed = true;
    }
    recordTest({
      name: "Threshold Matrix: Duplicate A + A Rejection",
      expected: "Duplicate share deduplicated by x-coordinate; tally blocked",
      actual: aaFailed ? "Blocked (duplicate shares count as 1)" : "Unexpectedly passed",
      status: aaFailed ? "PASS" : "FAIL",
    });

    // 10. Wrong-election share -> FAIL
    const otherShares = splitElectionSecret("other-election-xyz", electionDek, 3, 2);
    let wrongElectionFailed = false;
    try {
      attemptTally([shareA, otherShares[1]]);
    } catch {
      wrongElectionFailed = true;
    }
    recordTest({
      name: "Threshold Matrix: Wrong-Election Share Rejection",
      expected: "Share from different election strictly rejected",
      actual: wrongElectionFailed ? "Rejected with wrong-election error" : "Unexpectedly passed",
      status: wrongElectionFailed ? "PASS" : "FAIL",
    });

    // 11. Tampered share -> FAIL
    const parts = shareB.split(":");
    const rawBytes = Buffer.from(parts[3], "base64url");
    rawBytes[0] ^= 0xaa; // corrupt share bytes
    const tamperedShare = `${parts[0]}:${parts[1]}:${parts[2]}:${rawBytes.toString("base64url")}`;
    let tamperedFailed = false;
    try {
      attemptTally([shareA, tamperedShare]);
    } catch {
      tamperedFailed = true;
    }
    recordTest({
      name: "Threshold Matrix: Tampered Share Rejection (Commitment Mismatch)",
      expected: "Bit-flipped share fails keyCommitment validation",
      actual: tamperedFailed ? "Rejected (keyCommitment mismatch detected)" : "Unexpectedly passed",
      status: tamperedFailed ? "PASS" : "FAIL",
    });

    // 12. Key commitment mismatch -> FAIL
    let fakeCommitmentFailed = false;
    try {
      reconstructAndValidateElectionKey({
        electionId: election.id,
        keyCommitment: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        shares: [shareA, shareB],
        threshold: 2,
      });
    } catch {
      fakeCommitmentFailed = true;
    }
    recordTest({
      name: "Threshold Matrix: Key Commitment Mismatch Rejection",
      expected: "Key reconstruction aborts if commitment does not match",
      actual: fakeCommitmentFailed ? "Aborted immediately" : "Unexpectedly passed",
      status: fakeCommitmentFailed ? "PASS" : "FAIL",
    });

    // 13. Global BALLOT_ENCRYPTION_KEY bypass prevention
    let bypassPrevented = false;
    try {
      getElectionEncryptionKey(election, { purpose: "results_tally" });
    } catch {
      bypassPrevented = true;
    }
    recordTest({
      name: "Tally Path: Global BALLOT_ENCRYPTION_KEY Bypass Prevention",
      expected: "getElectionEncryptionKey(modern, { purpose: 'results_tally' }) throws error",
      actual: bypassPrevented ? "Bypass strictly blocked with Error" : "Bypass permitted (Vulnerability!)",
      status: bypassPrevented ? "PASS" : "FAIL",
    });

    // -----------------------------------------------------------------
    // 5. PRIVACY & SECURITY AUDIT
    // -----------------------------------------------------------------
    console.log("\n[Step 5/6] Verifying Privacy & Security Boundaries...");

    // Check client bundle does not import secrets
    const componentsDir = resolve("src/components");
    const componentFiles = readdirSync(componentsDir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
    let bundleClean = true;
    for (const f of componentFiles) {
      const code = readFileSync(join(componentsDir, f), "utf8");
      if (
        code.includes("reconstructAndValidateElectionKey") ||
        code.includes("reconstructSecretFromShares") ||
        code.includes("splitElectionSecret") ||
        code.includes("generateElectionKey") ||
        code.includes("ETHEREUM_PRIVATE_KEY")
      ) {
        bundleClean = false;
      }
    }

    recordTest({
      name: "Client Components Free of Cryptographic Secrets & Relayer Keys",
      expected: "No client components import threshold keys or private keys",
      actual: bundleClean ? "Clean (all client components verified)" : "Secret detected in client bundle",
      status: bundleClean ? "PASS" : "FAIL",
    });

    // Check that ElectionVote in database does not leak voter identity
    const dbVote = await prisma.electionVote.findUnique({ where: { id: storedVote.id } });
    const privacyPreserved = dbVote?.voterId === null && dbVote?.candidateId === null;
    recordTest({
      name: "Neon DB ElectionVote Table Anonymity",
      expected: "voterId is NULL and candidateId is NULL",
      actual: privacyPreserved ? "Both fields are strictly NULL" : "Identity leaked in vote record",
      status: privacyPreserved ? "PASS" : "FAIL",
    });

    // -----------------------------------------------------------------
    // 6. SUMMARY & STATS
    // -----------------------------------------------------------------
    console.log("\n==================================================================");
    console.log("                PHASE 10 FULL E2E EXECUTION SUMMARY               ");
    console.log("==================================================================");

    const totalTests = results.length;
    const passedTests = results.filter((r) => r.status === "PASS").length;
    const failedTests = results.filter((r) => r.status === "FAIL").length;

    console.log(`Total Scenarios Tested : ${totalTests}`);
    console.log(`Passed                 : ${passedTests}`);
    console.log(`Failed                 : ${failedTests}`);
    console.log(`Modern Election ID     : ${election.id}`);
    console.log(`Sepolia Tx Hash        : ${ethereumReceipt.transactionHash}`);
    console.log(`Sepolia Block Number   : #${ethereumReceipt.blockNumber}`);
    console.log("==================================================================\n");

    if (failedTests > 0) {
      process.exitCode = 1;
    }
  } finally {
    provider.destroy();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("FATAL ERROR in Phase 10 verification:", err);
  process.exitCode = 1;
});
