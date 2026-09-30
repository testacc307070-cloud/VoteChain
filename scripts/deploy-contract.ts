import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ContractFactory, JsonRpcProvider, Wallet, formatEther, formatUnits, type InterfaceAbi } from "ethers";
import solc from "solc";

function loadEnv() {
  for (const envFile of [".env", ".env.local"]) {
    const fullPath = resolve(envFile);
    if (!existsSync(fullPath)) continue;
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
}

function updateEnvFile(updates: Record<string, string>) {
  const envPath = resolve(".env");
  if (!existsSync(envPath)) return;
  let content = readFileSync(envPath, "utf8");
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `${key}="${value}"`);
    } else {
      content += `\n${key}="${value}"`;
    }
  }
  writeFileSync(envPath, content, "utf8");
}

loadEnv();

async function main() {
  const source = await readFile(resolve("contracts/VoteChainLedger.sol"), "utf8");
  const input = {
    language: "Solidity",
    sources: { "VoteChainLedger.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input))) as {
    errors?: Array<{ severity: string; formattedMessage: string }>;
    contracts: { "VoteChainLedger.sol": { VoteChainLedger: { abi: InterfaceAbi; evm: { bytecode: { object: string } } } } };
  };
  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  if (errors.length > 0) throw new Error(errors.map((error) => error.formattedMessage).join("\n"));

  const rpcUrl =
    process.env.ETHEREUM_RPC_URL && !process.env.ETHEREUM_RPC_URL.includes("127.0.0.1") && !process.env.ETHEREUM_RPC_URL.includes("localhost")
      ? process.env.ETHEREUM_RPC_URL
      : "https://ethereum-sepolia-rpc.publicnode.com";

  const privateKey = process.env.ETHEREUM_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("ETHEREUM_PRIVATE_KEY is required for automated Sepolia deployment.");
  }

  const provider = new JsonRpcProvider(rpcUrl);

  try {
    const network = await provider.getNetwork();
    console.log(`Connected to Network : Chain ID ${network.chainId}`);

    // Strictly enforce Ethereum Sepolia (Chain ID: 11155111)
    if (network.chainId !== BigInt(11155111)) {
      throw new Error(`Deployment safety check failed: Expected Ethereum Sepolia (Chain ID 11155111), but connected to Chain ID ${network.chainId}.`);
    }

    const wallet = new Wallet(privateKey, provider);
    const balance = await provider.getBalance(wallet.address);
    console.log(`Deployer Address     : ${wallet.address}`);
    console.log(`Wallet Balance       : ${formatEther(balance)} Sepolia ETH`);

    if (balance === BigInt(0)) {
      throw new Error("Insufficient funds in deployment wallet. Please fund the wallet before deploying.");
    }

    const artifact = output.contracts["VoteChainLedger.sol"].VoteChainLedger;
    const factory = new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, wallet);

    console.log("\nSubmitting VoteChainLedger deployment transaction to Ethereum Sepolia...");
    const contract = await factory.deploy();
    const deployTx = contract.deploymentTransaction();
    if (!deployTx) throw new Error("Deployment transaction was not created.");

    console.log(`Transaction Hash     : ${deployTx.hash}`);
    console.log("Waiting for confirmation on Ethereum Sepolia...");

    const receipt = await deployTx.wait(1);
    if (!receipt || receipt.status !== 1) {
      throw new Error(`Deployment transaction failed or reverted (status: ${receipt?.status})`);
    }

    const address = await contract.getAddress();
    console.log(`\n================================================================`);
    console.log(`VOTECHAINLEDGER DEPLOYED SUCCESSFULLY TO ETHEREUM SEPOLIA`);
    console.log(`================================================================`);
    console.log(`Contract Address     : ${address}`);
    console.log(`Transaction Hash     : ${receipt.hash}`);
    console.log(`Block Number         : #${receipt.blockNumber}`);
    console.log(`Gas Used             : ${receipt.gasUsed.toString()}`);
    console.log(`Effective Gas Price  : ${formatUnits(receipt.gasPrice ?? BigInt(0), "gwei")} Gwei`);
    console.log(`Chain ID             : ${network.chainId}`);
    console.log(`Explorer Link        : https://sepolia.etherscan.io/address/${address}`);
    console.log(`================================================================\n`);

    // Verify contract responds on Sepolia
    console.log("Verifying deployed contract responds on Ethereum Sepolia...");
    const commitmentTest = await (contract as unknown as { commitmentUsed: (c: string) => Promise<boolean> }).commitmentUsed(
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    );
    console.log(`✓ Contract query verified: commitmentUsed returns ${commitmentTest}`);

    const artifactPath = resolve("contracts/VoteChainLedger.json");
    await writeFile(artifactPath, JSON.stringify({ abi: artifact.abi, address }, null, 2));
    console.log(`✓ Artifact saved to ${artifactPath}`);

    updateEnvFile({
      ETHEREUM_RPC_URL: rpcUrl,
      VOTECHAIN_CONTRACT_ADDRESS: address,
    });
    console.log(`✓ Updated .env with VOTECHAIN_CONTRACT_ADDRESS and ETHEREUM_RPC_URL.`);
  } finally {
    provider.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});