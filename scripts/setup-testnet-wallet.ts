import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { JsonRpcProvider, Wallet, formatEther } from "ethers";

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

async function probeBalance(name: string, rpcUrl: string, address: string, symbol: string): Promise<void> {
  const provider = new JsonRpcProvider(rpcUrl);
  try {
    const network = await Promise.race([
      provider.getNetwork(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timeout detecting network")), 5000)),
    ]);
    const bal = await Promise.race([
      provider.getBalance(address),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timeout getting balance")), 5000)),
    ]);
    console.log(`- ${name.padEnd(20)}: ${formatEther(bal)} ${symbol} (Chain ID: ${network.chainId})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unreachable";
    console.log(`- ${name.padEnd(20)}: RPC unreachable (${message})`);
  } finally {
    // Explicitly destroy the provider to terminate background retry timers and event loops
    provider.destroy();
  }
}

async function run() {
  const envPath = resolve(".env");
  let privateKey = process.env.ETHEREUM_PRIVATE_KEY?.trim();

  if (!privateKey) {
    const newWallet = Wallet.createRandom();
    privateKey = newWallet.privateKey;

    const envAddition = `\n# Dedicated EVM Testnet Deployment Wallet (Phase 7)\nETHEREUM_PRIVATE_KEY="${privateKey}"\n`;
    appendFileSync(envPath, envAddition, "utf8");
    console.log("==> Generated new dedicated deployment wallet and saved ETHEREUM_PRIVATE_KEY to .env locally.");
    console.log("Public Address:", newWallet.address);
  } else {
    try {
      const wallet = new Wallet(privateKey);
      console.log("==> Existing deployment wallet found in .env.");
      console.log("Public Address:", wallet.address);
    } catch {
      console.error("Invalid ETHEREUM_PRIVATE_KEY in .env");
      return;
    }
  }

  const wallet = new Wallet(privateKey);
  console.log("\nTarget Testnet: Ethereum Sepolia (Chain ID: 11155111)");
  console.log("Probing network endpoints for address:", wallet.address);

  // Probe primary public Sepolia RPC endpoint with guaranteed cleanup
  await probeBalance("Sepolia (PublicNode)", "https://ethereum-sepolia-rpc.publicnode.com", wallet.address, "ETH");
}

run().catch((err) => {
  console.error(err);
});
