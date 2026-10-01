import { createHash } from "node:crypto";

export type BlockchainBlock = {
  index: number;
  timestamp: number;
  previousHash: string;
  payload: string;
  hash: string;
};

export type BlockchainSummary = {
  blockCount: number;
  lastIndex: number;
  headHash: string;
  valid: boolean;
  genesisHash: string | null;
};

export function appendBlockchainBlock({
  previousHash,
  index,
  payload,
}: {
  previousHash: string;
  index: number;
  payload: string;
}): BlockchainBlock {
  const timestamp = Date.now();
  const base = `${index}:${timestamp}:${previousHash}:${payload}`;
  const hash = `sha256:${createHash("sha256").update(base).digest("hex")}`;

  return {
    index,
    timestamp,
    previousHash,
    payload,
    hash,
  };
}

export function appendNextBlockchainBlock({
  chain,
  payload,
}: {
  chain: BlockchainBlock[];
  payload: string;
}): BlockchainBlock {
  if (chain.length === 0) {
    return appendBlockchainBlock({
      previousHash: "GENESIS",
      index: 1,
      payload,
    });
  }

  const last = chain[chain.length - 1];
  return appendBlockchainBlock({
    previousHash: last.hash,
    index: last.index + 1,
    payload,
  });
}

export function verifyBlockchainChain(blocks: BlockchainBlock[]): boolean {
  if (blocks.length === 0) return false;

  for (let index = 1; index < blocks.length; index += 1) {
    const current = blocks[index];
    const previous = blocks[index - 1];

    if (current.previousHash !== previous.hash) {
      return false;
    }

    const expectedHash = `sha256:${createHash("sha256")
      .update(`${current.index}:${current.timestamp}:${current.previousHash}:${current.payload}`)
      .digest("hex")}`;

    if (current.hash !== expectedHash) {
      return false;
    }
  }

  return true;
}

export function buildBlockchainSummary(blocks: BlockchainBlock[]): BlockchainSummary {
  const valid = blocks.length > 0 && verifyBlockchainChain(blocks);
  const head = blocks.at(-1) ?? null;

  return {
    blockCount: blocks.length,
    lastIndex: head?.index ?? 0,
    headHash: head?.hash ?? "",
    valid,
    genesisHash: blocks[0]?.hash ?? null,
  };
}
