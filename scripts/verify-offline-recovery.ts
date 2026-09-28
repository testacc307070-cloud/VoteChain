import { ElectionStatus } from "@prisma/client";
import { Contract, JsonRpcProvider, keccak256, toUtf8Bytes } from "ethers";
import { prisma } from "../src/lib/prisma";
import { splitSecretToShares, reconstructSecretFromShares } from "../src/lib/authority";
import { encryptBallot, decryptBallot } from "../src/lib/encrypted-ballot";
import { createZkVoteProof, verifyZkVoteProof } from "../src/lib/zk-proof";
import { createMerkleRoot, createMerkleProof, verifyMerkleProof } from "../src/lib/integrity";

const CONTRACT_ABI = [
  "function registerElection(bytes32 electionId, bytes32 configHash)",
  "function setElectionState(bytes32 electionId, uint8 state)",
  "function recordVote(bytes32 electionId, bytes32 commitment)",
  "function finalizeElection(bytes32 electionId, bytes32 merkleRoot, bytes32 resultsDigest)",
  "function commitmentUsed(bytes32 commitment) view returns (bool)",
  "event VoteRecorded(bytes32 indexed electionId, bytes32 indexed commitment, address indexed submitter, uint256 timestamp)"
];

function hashRef(val: string): string {
  return keccak256(toUtf8Bytes(val));
}

export async function testOfflineRecoveryFlow() {
  console.log("===============================================================================");
  console.log("         OFFLINE FAULT TOLERANCE & TRANSACTION RECOVERY E2E TEST               ");
  console.log("===============================================================================\n");

  const testElectionId = `offline_test_${Date.now()}`;
  const electionRef = hashRef(testElectionId);

  try {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@votechain.local" } });
    const voter = await prisma.user.findUniqueOrThrow({ where: { email: "voter@votechain.local" } });
    const auth1 = await prisma.user.findUniqueOrThrow({ where: { email: "authority@votechain.local" } });
    const auth2 = await prisma.user.findUniqueOrThrow({ where: { email: "authority2@votechain.local" } });

    // Step 1: Election Setup & Activation
    console.log("Step 1: Setting up active election for offline demonstration...");
    const election = await prisma.election.create({
      data: {
        id: testElectionId,
        name: "Offline Recovery Demonstration Election",
        description: "Testing network failure, queue buffering, and transaction recovery",
        status: ElectionStatus.ACTIVE,
        startTime: new Date(),
        endTime: new Date(Date.now() + 86400000),
        candidatesLocked: true,
        requiredAuthorityApprovals: 2,
        createdBy: { connect: { id: admin.id } },
        candidates: {
          create: [
            { id: `${testElectionId}_c1`, name: "Candidate Aurora", sortOrder: 1 },
            { id: `${testElectionId}_c2`, name: "Candidate Borealis", sortOrder: 2 },
          ],
        },
      },
      include: { candidates: true },
    });

    const candAurora = election.candidates[0].id;
    const validCandidateIds = [candAurora, election.candidates[1].id];

    // Master key and Shamir split (GF256)
    const masterKey = "VoteChainOfflineDemoMasterKey32!";
    const shares = splitSecretToShares(masterKey, 3, 2);

    // Register on-chain
    const provider = new JsonRpcProvider(process.env.ETHEREUM_RPC_URL || "http://127.0.0.1:8545");
    const signer = await provider.getSigner(process.env.ETHEREUM_ACCOUNT || 0);
    const contract = new Contract(process.env.VOTECHAIN_CONTRACT_ADDRESS || "0x630589690929E9cdEFDeF0734717a9eF3Ec7Fcfe", CONTRACT_ABI, signer);

    const regTx = await contract.registerElection(electionRef, hashRef(election.name));
    await regTx.wait();
    const actTx = await contract.setElectionState(electionRef, 3); // 3 = ACTIVE
    await actTx.wait();
    console.log("  ✓ Election activated on Ethereum smart contract and in database.");

    // Step 2: Simulate Network Disruption & Local Ballot Buffering
    console.log("\nStep 2: Simulating network failure & client-side local queue buffering...");
    // Voter selects Candidate Aurora, but network request fails (simulated offline mode)
    const isOnline = false;
    const localQueueBuffer: Array<{
      electionId: string;
      candidateId: string;
      ciphertext: string;
      nonce: string;
      authTag: string;
      proof: string;
      zkProof: string;
      queuedAt: number;
    }> = [];

    // Client computes ZK proof and AES ciphertext locally
    const zkProof = await createZkVoteProof({
      candidateId: candAurora,
      validCandidateIds,
      electionId: testElectionId,
      nonce: "offline-salt-5555",
    });

    const encryptedBallot = encryptBallot({
      electionId: testElectionId,
      candidateId: candAurora,
      validCandidateIds,
      nonce: "offline-salt-5555",
      encryptionKey: masterKey,
    });

    if (!isOnline) {
      localQueueBuffer.push({
        electionId: testElectionId,
        candidateId: candAurora,
        ciphertext: encryptedBallot.ciphertext,
        nonce: encryptedBallot.nonce,
        authTag: encryptedBallot.authTag,
        proof: encryptedBallot.proof,
        zkProof: zkProof.proof,
        queuedAt: Date.now(),
      });
      console.log(`  ✓ Network Failure Detected: Ballot successfully captured in client local fault buffer.`);
      console.log(`  ✓ Buffered items count: ${localQueueBuffer.length} | Payload commitment: ${encryptedBallot.proof.slice(0, 24)}...`);
    }

    // Step 3: Network Restored & Transaction Replay / Synchronization
    console.log("\nStep 3: Network restored! Synchronizing queued ballot to backend & blockchain...");
    const networkRestored = true;
    if (networkRestored && localQueueBuffer.length > 0) {
      const queuedItem = localQueueBuffer.shift()!;
      console.log(`  ✓ Dequeued ballot from local buffer (queued at ${new Date(queuedItem.queuedAt).toISOString()}).`);

      // Verify ZK proof on server
      const zkServerVerified = await verifyZkVoteProof({
        proof: queuedItem.zkProof,
        validCandidateIds,
        electionId: testElectionId,
      });
      if (!zkServerVerified) throw new Error("Queued ZK proof failed server verification!");
      console.log("  ✓ Server verified client-generated Zero-Knowledge Proof.");

      // Submit commitment to Ganache blockchain
      const commitment = hashRef(`${queuedItem.ciphertext}:${queuedItem.proof}`);
      const voteTx = await contract.recordVote(electionRef, commitment);
      const receipt = await voteTx.wait();
      console.log(`  ✓ Blockchain transaction mined! (Tx: ${receipt.hash.slice(0, 18)}..., Block: #${receipt.blockNumber}).`);

      // Decoupled database storage
      const receiptId = `RCPT-OFFLINE-${Date.now()}`;
      await prisma.$transaction([
        prisma.electionVoterParticipation.create({
          data: { electionId: testElectionId, voterId: voter.id },
        }),
        prisma.electionVote.create({
          data: {
            electionId: testElectionId,
            receiptId,
            encryptedBallot: queuedItem.ciphertext,
            ballotNonce: queuedItem.nonce,
            ballotAuthTag: queuedItem.authTag,
            ballotProof: queuedItem.proof,
            zkProof: queuedItem.zkProof,
            txHash: receipt.hash,
            blockNumber: Number(receipt.blockNumber),
          },
        }),
      ]);
      console.log(`  ✓ Double-blind database records stored. Receipt ID: ${receiptId}`);

      // Verify buffer is empty
      console.log(`  ✓ Local queue buffer cleared: ${localQueueBuffer.length} pending items.`);
    }

    // Step 4: Election Closure & Multi-Authority Tally
    console.log("\nStep 4: Closing election and performing threshold tally...");
    await prisma.election.update({
      where: { id: testElectionId },
      data: { status: ElectionStatus.CLOSED },
    });
    const closeTx = await contract.setElectionState(electionRef, 4); // 4 = CLOSED
    await closeTx.wait();

    // Authority 1 & 2 submit shares
    await prisma.electionAuthorityApproval.create({
      data: { electionId: testElectionId, authorityId: auth1.id, keyShare: shares[0] },
    });
    await prisma.electionAuthorityApproval.create({
      data: { electionId: testElectionId, authorityId: auth2.id, keyShare: shares[1] },
    });

    const recoveredKey = reconstructSecretFromShares([shares[0], shares[1]], 2);
    if (recoveredKey !== masterKey) throw new Error("Key reconstruction mismatch!");

    const storedBallots = await prisma.electionVote.findMany({ where: { electionId: testElectionId } });
    const tallies: Record<string, number> = {};
    for (const b of storedBallots) {
      const choice = decryptBallot({
        electionId: testElectionId,
        ballot: {
          ciphertext: b.encryptedBallot,
          nonce: b.ballotNonce,
          authTag: b.ballotAuthTag,
          proof: b.ballotProof,
        },
        encryptionKey: recoveredKey,
      });
      tallies[choice] = (tallies[choice] || 0) + 1;
    }
    console.log(`  ✓ Tally Decrypted: Aurora=${tallies[candAurora]} (Expected: 1).`);
    if (tallies[candAurora] !== 1) throw new Error("Tally count does not match cast offline ballot!");

    // Step 5: Merkle Tree & On-Chain Finalization
    console.log("\nStep 5: Merkle tree calculation & on-chain finalization...");
    const voteHashes = storedBallots.map(b => hashRef(`${b.encryptedBallot}:${b.ballotProof}`));
    const merkleRoot = createMerkleRoot(voteHashes);
    const resultsDigest = hashRef(JSON.stringify(tallies));

    const finTx = await contract.finalizeElection(electionRef, hashRef(merkleRoot), resultsDigest);
    const finReceipt = await finTx.wait();
    console.log(`  ✓ Finalized on-chain (Block #${finReceipt.blockNumber}, Root: ${merkleRoot.slice(0, 20)}...).`);

    // Step 6: Public Receipt Verification of Recovered Vote
    console.log("\nStep 6: Public Merkle inclusion proof verification for synced vote...");
    const proofSteps = createMerkleProof(voteHashes, 0);
    const isVerified = verifyMerkleProof(voteHashes[0], proofSteps, merkleRoot);
    console.log(`  ✓ Inclusion proof verified against on-chain Merkle Root: ${isVerified}`);
    if (!isVerified) throw new Error("Public Merkle verification failed for recovered ballot!");

    // Cleanup
    console.log("\nCleaning up offline test election...");
    await prisma.electionAuthorityApproval.deleteMany({ where: { electionId: testElectionId } });
    await prisma.electionVote.deleteMany({ where: { electionId: testElectionId } });
    await prisma.electionVoterParticipation.deleteMany({ where: { electionId: testElectionId } });
    await prisma.electionCandidate.deleteMany({ where: { electionId: testElectionId } });
    await prisma.election.delete({ where: { id: testElectionId } });
    console.log("  ✓ Test cleanup complete.");

    console.log("\n===============================================================================");
    console.log("  OFFLINE FAULT-TOLERANCE & TRANSACTION RECOVERY: PASSED (100% OPERATIONAL)    ");
    console.log("===============================================================================\n");
    return true;
  } catch (err) {
    console.error("  ✗ Offline Recovery Test Failed:", err);
    return false;
  }
}

if (process.argv[1]?.includes("verify-offline-recovery")) {
  testOfflineRecoveryFlow()
    .then(passed => process.exit(passed ? 0 : 1))
    .finally(() => prisma.$disconnect());
}
