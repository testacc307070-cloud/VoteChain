import { createHash } from "node:crypto";

export type IntegritySnapshot = {
  electionId: string;
  totalVotes: number;
  validVotes: number;
  invalidVotes: number;
  blockHeight: number;
  merkleRoot: string;
  status: "VALID" | "INVALID";
};

export type MerkleProofStep = {
  hash: string;
  position: "left" | "right";
};

export function createMerkleRoot(values: string[]): string {
  if (values.length === 0) {
    return "sha256:empty";
  }

  let layer = values.map((value) => createHash("sha256").update(value).digest("hex"));

  while (layer.length > 1) {
    const nextLayer: string[] = [];
    for (let index = 0; index < layer.length; index += 2) {
      const left = layer[index];
      const right = layer[index + 1] ?? left;
      nextLayer.push(createHash("sha256").update(`${left}:${right}`).digest("hex"));
    }
    layer = nextLayer;
  }

  return `sha256:${layer[0]}`;
}

export function createMerkleProof(values: string[], targetIndex: number): MerkleProofStep[] {
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= values.length) {
    throw new Error("Merkle proof target index is out of range.");
  }

  const proof: MerkleProofStep[] = [];
  let index = targetIndex;
  let layer = values.map((value) => createHash("sha256").update(value).digest("hex"));

  while (layer.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    proof.push({
      hash: layer[siblingIndex] ?? layer[index],
      position: index % 2 === 0 ? "right" : "left",
    });

    const nextLayer: string[] = [];
    for (let layerIndex = 0; layerIndex < layer.length; layerIndex += 2) {
      const right = layer[layerIndex + 1] ?? layer[layerIndex];
      nextLayer.push(createHash("sha256").update(`${layer[layerIndex]}:${right}`).digest("hex"));
    }
    index = Math.floor(index / 2);
    layer = nextLayer;
  }

  return proof;
}

export function verifyMerkleProof(value: string, proof: MerkleProofStep[], root: string): boolean {
  if (!root.startsWith("sha256:") || root === "sha256:empty") return false;

  let current = createHash("sha256").update(value).digest("hex");
  for (const step of proof) {
    current = step.position === "left"
      ? createHash("sha256").update(`${step.hash}:${current}`).digest("hex")
      : createHash("sha256").update(`${current}:${step.hash}`).digest("hex");
  }

  return `sha256:${current}` === root;
}

export function buildElectionIntegritySnapshot({
  electionId,
  totalVotes,
  validVotes,
  invalidVotes,
  blockHeight,
}: {
  electionId: string;
  totalVotes: number;
  validVotes: number;
  invalidVotes: number;
  blockHeight: number;
}): IntegritySnapshot {
  const isValid = invalidVotes === 0 && validVotes >= 0 && totalVotes === validVotes + invalidVotes;

  return {
    electionId,
    totalVotes,
    validVotes,
    invalidVotes,
    blockHeight,
    merkleRoot: createMerkleRoot(
      Array.from({ length: Math.max(totalVotes, 1) }, (_, index) => `vote:${electionId}:${index + 1}`),
    ),
    status: isValid ? "VALID" : "INVALID",
  };
}
