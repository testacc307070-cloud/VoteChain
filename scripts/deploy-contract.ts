import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ContractFactory, JsonRpcProvider, Wallet, type InterfaceAbi } from "ethers";
import solc from "solc";

async function main() {
  const source = await readFile(resolve("contracts/VoteChainLedger.sol"), "utf8");
  const input = {
    language: "Solidity",
    sources: { "VoteChainLedger.sol": { content: source } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input))) as {
    errors?: Array<{ severity: string; formattedMessage: string }>;
    contracts: { "VoteChainLedger.sol": { VoteChainLedger: { abi: InterfaceAbi; evm: { bytecode: { object: string } } } } };
  };
  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  if (errors.length > 0) throw new Error(errors.map((error) => error.formattedMessage).join("\n"));

  const rpcUrl = process.env.ETHEREUM_RPC_URL;
  const privateKey = process.env.ETHEREUM_PRIVATE_KEY;
  if (!rpcUrl) throw new Error("ETHEREUM_RPC_URL is required.");

  const artifact = output.contracts["VoteChainLedger.sol"].VoteChainLedger;
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = privateKey
    ? new Wallet(privateKey, provider)
    : await provider.getSigner(process.env.ETHEREUM_ACCOUNT ?? 0);
  const contract = await new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, wallet).deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  const artifactPath = resolve("contracts/VoteChainLedger.json");
  await writeFile(artifactPath, JSON.stringify({ abi: artifact.abi, address }, null, 2));
  console.log(`VoteChainLedger deployed at ${address}`);
  console.log(`Write VOTECHAIN_CONTRACT_ADDRESS=${address} to .env`);
  console.log(`Artifact written to ${dirname(artifactPath)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});