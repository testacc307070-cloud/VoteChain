import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from "ethers";

const ledgerAbi = [
  "function recordVote(bytes32 electionId, bytes32 commitment)",
  "function commitmentUsed(bytes32 commitment) view returns (bool)",
  "function getElection(bytes32 electionId) view returns (bytes32 configHash, uint8 state, bytes32 merkleRoot, bytes32 resultsDigest, uint256 voteCount)",
  "event VoteRecorded(bytes32 indexed electionId, bytes32 indexed commitment, address indexed submitter, uint256 timestamp)",
];

function ethereumConfig() {
  const rpcUrl = process.env.ETHEREUM_RPC_URL;
  const privateKey = process.env.ETHEREUM_PRIVATE_KEY;
  const contractAddress = process.env.VOTECHAIN_CONTRACT_ADDRESS;
  if (!rpcUrl || !contractAddress) {
    throw new Error("ETHEREUM_RPC_URL and VOTECHAIN_CONTRACT_ADDRESS are required.");
  }
  return { rpcUrl, privateKey, contractAddress, account: process.env.ETHEREUM_ACCOUNT };
}

function hashReference(value: string) {
  return keccak256(toUtf8Bytes(value));
}

export async function submitVoteOnChain({
  electionId,
  ciphertext,
  proof,
}: {
  electionId: string;
  ciphertext: string;
  proof: string;
}) {
  const config = ethereumConfig();
  const provider = new JsonRpcProvider(config.rpcUrl);
  try {
    const signer = config.privateKey
      ? new Wallet(config.privateKey, provider)
      : await provider.getSigner(config.account ?? 0);
    const ledger = new Contract(config.contractAddress, ledgerAbi, signer);
    const commitment = hashReference(`${ciphertext}:${proof}`);
    const electionIdHash = hashReference(electionId);

    // Concurrency / nonce retry logic for serverless environments
    let attempts = 0;
    let lastError: unknown = null;
    while (attempts < 3) {
      attempts++;
      try {
        const nonce = await provider.getTransactionCount(await signer.getAddress(), "pending");
        const transaction = await ledger.recordVote(electionIdHash, commitment, { nonce });
        const receipt = await transaction.wait(1);
        if (!receipt?.blockNumber) throw new Error("Ethereum transaction was not mined.");

        return {
          transactionHash: transaction.hash,
          blockNumber: Number(receipt.blockNumber),
          commitment,
        };
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        // Immediate failure on duplicate commitment (one-person-one-vote replay protection)
        if (msg.includes("commitment already recorded")) {
          throw err;
        }
        // Retry on nonce collisions or mempool replacement errors
        if (msg.includes("nonce") || msg.includes("replacement") || msg.includes("underpriced") || msg.includes("already known")) {
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        throw err;
      }
    }
    throw lastError || new Error("Failed to submit vote on-chain after retries.");
  } finally {
    provider.destroy();
  }
}

export async function verifyOnChainCommitment(commitment: string) {
  const config = ethereumConfig();
  const provider = new JsonRpcProvider(config.rpcUrl);
  try {
    const ledger = new Contract(config.contractAddress, ledgerAbi, provider);
    return Boolean(await ledger.commitmentUsed(commitment));
  } finally {
    provider.destroy();
  }
}

export async function getOnChainElection(electionId: string) {
  const config = ethereumConfig();
  const provider = new JsonRpcProvider(config.rpcUrl);
  try {
    const ledger = new Contract(config.contractAddress, ledgerAbi, provider);
    const election = await ledger.getElection(hashReference(electionId));
    return {
      configHash: election[0] as string,
      state: Number(election[1]),
      merkleRoot: election[2] as string,
      resultsDigest: election[3] as string,
      voteCount: Number(election[4]),
    };
  } finally {
    provider.destroy();
  }
}