import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/database/prisma";
import { verifyOnChainCommitment } from "@/blockchain/ethereum";
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

async function main() {
  console.log("=== FINAL READ-ONLY VERIFICATION OF BROWSER-SUBMITTED VOTE ===");
  const electionName = "Phase 8 Browser Test Election (Sepolia)";
  const election = await prisma.election.findFirst({
    where: { name: electionName },
    include: {
      votes: true,
      participations: {
        include: {
          voter: { select: { id: true, name: true, email: true, voterId: true } },
        },
      },
      blocks: true,
      candidates: true,
      eligibleVoters: true,
    },
  });

  if (!election) {
    console.error(`Election "${electionName}" not found.`);
    return;
  }

  console.log(`Election ID          : ${election.id}`);
  console.log(`Status               : ${election.status}`);
  console.log(`Total Candidates     : ${election.candidates.length}`);
  console.log(`Total Eligible Voters: ${election.eligibleVoters.length}`);
  console.log(`Total Participations : ${election.participations.length}`);
  console.log(`Total Votes Cast     : ${election.votes.length}`);
  console.log(`Total App Blocks     : ${election.blocks.length}`);

  if (election.votes.length === 0) {
    console.log("No votes found in database yet.");
    return;
  }

  const vote = election.votes[0];
  console.log("\n--- BROWSER VOTE RECORD (NEON DB) ---");
  console.log(`Vote ID              : ${vote.id}`);
  console.log(`Receipt ID           : ${vote.receiptId}`);
  console.log(`Tx Hash              : ${vote.txHash}`);
  console.log(`Block Number         : #${vote.blockNumber}`);
  console.log(`Submitted At         : ${vote.submittedAt.toISOString()}`);
  console.log(`Encrypted Ballot     : ${vote.encryptedBallot.slice(0, 20)}... (Length: ${vote.encryptedBallot.length})`);
  console.log(`Ballot Auth Tag      : ${vote.ballotAuthTag.slice(0, 10)}...`);
  console.log(`Ballot Nonce         : ${vote.ballotNonce.slice(0, 10)}...`);
  console.log(`Ballot Proof         : ${vote.ballotProof.slice(0, 20)}...`);
  console.log(`ZK Proof Present     : ${Boolean(vote.zkProof)} (Length: ${vote.zkProof?.length ?? 0})`);
  console.log(`Voter Link In Vote   : voterId is ${vote.voterId ?? "NULL (Double-Blind Anonymized)"}`);
  console.log(`Candidate Link In Vote: candidateId is ${vote.candidateId ?? "NULL (Preserves Secret Ballot)"}`);

  // Calculate commitment
  const commitment = keccak256(toUtf8Bytes(`${vote.encryptedBallot}:${vote.ballotProof}`));
  console.log(`Computed Commitment  : ${commitment}`);

  // Verify on Sepolia
  console.log("\n--- SEPOLIA BLOCKCHAIN VERIFICATION ---");
  const isCommitmentOnChain = await verifyOnChainCommitment(commitment);
  console.log(`Commitment Recorded  : ${isCommitmentOnChain}`);
  console.log(`Sepolia Etherscan    : https://sepolia.etherscan.io/tx/${vote.txHash}`);

  // Check Relayer Balance & Transaction Status
  const rpcUrl = process.env.ETHEREUM_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  const provider = new JsonRpcProvider(rpcUrl);
  try {
    const deployerAddress = "0xd9f43Cd01A317849e54DbcCB03380dA3EDE5E063";
    const balanceWei = await provider.getBalance(deployerAddress);
    console.log(`Relayer Balance      : ${formatEther(balanceWei)} ETH`);
    
    // Check tx receipt directly from Sepolia
    const txReceipt = await provider.getTransactionReceipt(vote.txHash);
    if (txReceipt) {
      console.log(`Sepolia Tx Status    : ${txReceipt.status === 1 ? "SUCCESS (1)" : "FAILED (0)"}`);
      console.log(`Gas Used             : ${txReceipt.gasUsed.toString()}`);
      console.log(`Confirmed in Block   : #${txReceipt.blockNumber}`);
    }
  } finally {
    provider.destroy();
  }
}

main()
  .catch((err) => {
    console.error("Verification error:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
