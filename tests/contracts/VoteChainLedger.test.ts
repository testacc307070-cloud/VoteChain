import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from "ethers";
import solc from "solc";
import ganache from "ganache";

async function compileContract() {
  const source = await readFile(resolve("contracts/VoteChainLedger.sol"), "utf8");
  const input = {
    language: "Solidity",
    sources: { "VoteChainLedger.sol": { content: source } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  return output.contracts["VoteChainLedger.sol"].VoteChainLedger;
}

function hashReference(val: string): string {
  return keccak256(toUtf8Bytes(val));
}

test("VoteChainLedger smart contract automated test suite", async (t) => {
  let server: any = null;
  let provider: JsonRpcProvider | null = null;

  try {
    let rpcUrl = process.env.ETHEREUM_RPC_URL;
    let isEphemeral = false;

    // If no explicit local RPC URL is provided or if pointing to localhost without a daemon running,
    // spin up an ephemeral in-process Ganache node to guarantee isolated, deterministic testing.
    if (!rpcUrl || rpcUrl.includes("127.0.0.1") || rpcUrl.includes("localhost")) {
      server = ganache.server({
        wallet: { deterministic: true },
        logging: { quiet: true },
      });
      await server.listen(0);
      const port = (server.address() as { port: number }).port;
      rpcUrl = `http://127.0.0.1:${port}`;
      isEphemeral = true;
    }

    provider = new JsonRpcProvider(rpcUrl);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let signer: any;
    if (process.env.ETHEREUM_PRIVATE_KEY && !isEphemeral) {
      signer = new Wallet(process.env.ETHEREUM_PRIVATE_KEY, provider);
    } else {
      signer = await provider.getSigner(0);
    }

    const artifact = await compileContract();
    const factory = new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, signer);
    const contract = (await factory.deploy()) as Contract;
    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();

    assert.equal(typeof contractAddress, "string");
    assert.equal(contractAddress.startsWith("0x"), true);

    await t.test("registers an election with config hash on-chain", async () => {
      const electionId = hashReference("election-unit-test-1");
      const configHash = hashReference("config:student-council-2026");

      const tx = await contract.registerElection(electionId, configHash);
      const receipt = await tx.wait();
      assert.equal(receipt.status, 1);

      const info = await contract.getElection(electionId);
      assert.equal(info[0], configHash);
      assert.equal(info[1], BigInt(1)); // CREATED
    });

    await t.test("records a unique vote commitment on-chain", async () => {
      const electionId = hashReference("election-unit-test-1");
      const commitment = hashReference("ballot-commitment-user-1");

      const tx = await contract.recordVote(electionId, commitment);
      const receipt = await tx.wait();
      assert.equal(receipt.status, 1);

      const used = await contract.commitmentUsed(commitment);
      assert.equal(used, true);

      const info = await contract.getElection(electionId);
      assert.equal(info[4], BigInt(1)); // voteCount is 1
    });

    await t.test("rejects duplicate vote commitment (one-person-one-vote / replay prevention)", async () => {
      const electionId = hashReference("election-unit-test-1");
      const commitment = hashReference("ballot-commitment-user-1");

      await assert.rejects(
        async () => {
          const tx = await contract.recordVote(electionId, commitment);
          await tx.wait();
        },
        /reverted|CALL_EXCEPTION|commitment already recorded/,
      );
    });

    await t.test("records a second distinct vote commitment", async () => {
      const electionId = hashReference("election-unit-test-1");
      const commitment2 = hashReference("ballot-commitment-user-2");

      const tx = await contract.recordVote(electionId, commitment2);
      const receipt = await tx.wait();
      assert.equal(receipt.status, 1);

      const info = await contract.getElection(electionId);
      assert.equal(info[4], BigInt(2)); // voteCount is 2
    });

    await t.test("finalizes election with Merkle root and results digest", async () => {
      const electionId = hashReference("election-unit-test-1");
      const merkleRoot = hashReference("merkle-root:vote1+vote2");
      const resultsDigest = hashReference("results:candA=2:candB=0");

      const tx = await contract.finalizeElection(electionId, merkleRoot, resultsDigest);
      const receipt = await tx.wait();
      assert.equal(receipt.status, 1);

      const info = await contract.getElection(electionId);
      assert.equal(info[1], BigInt(5)); // FINALIZED
      assert.equal(info[2], merkleRoot);
      assert.equal(info[3], resultsDigest);
    });
  } finally {
    if (provider) {
      provider.destroy();
    }
    if (server) {
      await server.close();
    }
  }
});
