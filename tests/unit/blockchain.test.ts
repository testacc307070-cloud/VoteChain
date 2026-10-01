import assert from "node:assert/strict";
import test from "node:test";

import {
  appendBlockchainBlock,
  appendNextBlockchainBlock,
  buildBlockchainSummary,
  verifyBlockchainChain,
} from "@/blockchain/blockchain";

test("builds a valid chain when each block references the previous hash", () => {
  const genesis = appendBlockchainBlock({
    previousHash: "GENESIS",
    index: 1,
    payload: JSON.stringify({ electionId: "election-1", voteId: "vote-1" }),
  });
  const second = appendBlockchainBlock({
    previousHash: genesis.hash,
    index: 2,
    payload: JSON.stringify({ electionId: "election-1", voteId: "vote-2" }),
  });

  const valid = verifyBlockchainChain([genesis, second]);
  assert.equal(valid, true);
  assert.equal(genesis.hash.startsWith("sha256:"), true);
  assert.equal(second.previousHash, genesis.hash);
});

test("rejects a chain with a tampered block hash", () => {
  const genesis = appendBlockchainBlock({
    previousHash: "GENESIS",
    index: 1,
    payload: JSON.stringify({ electionId: "election-1", voteId: "vote-1" }),
  });
  const tampered = {
    ...genesis,
    payload: JSON.stringify({ electionId: "election-1", voteId: "tampered" }),
  };

  const valid = verifyBlockchainChain([genesis, tampered]);
  assert.equal(valid, false);
});

test("appends the next block using the current chain head as the previous hash", () => {
  const initial = appendBlockchainBlock({
    previousHash: "GENESIS",
    index: 1,
    payload: JSON.stringify({ electionId: "election-1", voteId: "vote-1" }),
  });

  const next = appendNextBlockchainBlock({
    chain: [initial],
    payload: JSON.stringify({ electionId: "election-1", voteId: "vote-2" }),
  });

  assert.equal(next.index, 2);
  assert.equal(next.previousHash, initial.hash);
  assert.equal(verifyBlockchainChain([initial, next]), true);
});

test("builds a summary for the persisted election ledger", () => {
  const genesis = appendBlockchainBlock({
    previousHash: "GENESIS",
    index: 1,
    payload: JSON.stringify({ electionId: "election-1", voteId: "vote-1" }),
  });
  const next = appendNextBlockchainBlock({
    chain: [genesis],
    payload: JSON.stringify({ electionId: "election-1", voteId: "vote-2" }),
  });

  const summary = buildBlockchainSummary([genesis, next]);

  assert.equal(summary.blockCount, 2);
  assert.equal(summary.headHash, next.hash);
  assert.equal(summary.valid, true);
  assert.equal(summary.lastIndex, 2);
});
