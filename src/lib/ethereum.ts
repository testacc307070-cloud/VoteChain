import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from "ethers";

const ledgerAbi = [
  "function recordVote(bytes32 electionId, bytes32 commitment)",
  "function commitmentUsed(bytes32 commitment) view returns (bool)",
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
  const signer = config.privateKey
    ? new Wallet(config.privateKey, provider)
    : await provider.getSigner(config.account ?? 0);
  const ledger = new Contract(config.contractAddress, ledgerAbi, signer);
  const commitment = hashReference(`${ciphertext}:${proof}`);
  const transaction = await ledger.recordVote(hashReference(electionId), commitment);
  const receipt = await transaction.wait();
  if (!receipt?.blockNumber) throw new Error("Ethereum transaction was not mined.");

  return {
    transactionHash: transaction.hash,
    blockNumber: Number(receipt.blockNumber),
    commitment,
  };
}

export async function verifyOnChainCommitment(commitment: string) {
  const config = ethereumConfig();
  const provider = new JsonRpcProvider(config.rpcUrl);
  const ledger = new Contract(config.contractAddress, ledgerAbi, provider);
  return Boolean(await ledger.commitmentUsed(commitment));
}