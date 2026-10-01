import { createHash, randomBytes } from "node:crypto";
// @ts-expect-error circomlibjs has no official typescript types
import { buildBabyjub, buildPoseidon } from "circomlibjs";

export type ZkProofInput = {
  electionId: string;
  candidateId: string;
  validCandidateIds: string[];
  nonce: string;
};

export type ZkVoteProof = {
  proof: string;
  valid: boolean;
  publicStatement: string;
  commitment: { x: string; y: string };
  challenges: string[];
  responses: string[];
};

// Cached cryptographic primitives for performance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let babyJubInstance: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let poseidonInstance: any = null;

async function getCrypto() {
  if (!babyJubInstance || !poseidonInstance) {
    babyJubInstance = await buildBabyjub();
    poseidonInstance = await buildPoseidon();
  }
  return { babyJub: babyJubInstance, poseidon: poseidonInstance };
}

// Deterministic second generator H on BabyJubjub curve (Nothing-Up-My-Sleeve)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getGeneratorH(babyJub: any) {
  const seed = BigInt(`0x${createHash("sha256").update("VoteChainGeneratorH_Seed").digest("hex")}`) % babyJub.order;
  return babyJub.mulPointEscalar(babyJub.Base8, seed);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function negPoint(F: any, P: [any, any]): [any, any] {
  return [F.neg(P[0]), P[1]];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function subPoint(babyJub: any, P1: [any, any], P2: [any, any]): [any, any] {
  return babyJub.addPoint(P1, negPoint(babyJub.F, P2));
}

function randomScalar(order: bigint): bigint {
  const buf = randomBytes(32);
  const val = BigInt(`0x${buf.toString("hex")}`) % (order - BigInt(1));
  return val + BigInt(1);
}

/**
 * Creates a true Cramer-Damgård-Schoenmakers (CDS) 1-out-of-N Non-Interactive Zero-Knowledge Proof.
 * Proves that the committed choice is one of the valid candidate indices without revealing which one.
 */
export async function createZkVoteProof({
  electionId,
  candidateId,
  validCandidateIds,
  nonce,
}: ZkProofInput): Promise<ZkVoteProof> {
  const { babyJub, poseidon } = await getCrypto();
  const F = babyJub.F;
  const q: bigint = babyJub.order;
  const G = babyJub.Base8;
  const H = getGeneratorH(babyJub);

  const candidateIndex = validCandidateIds.indexOf(candidateId);
  const m = validCandidateIds.length;

  // Derive secret blinding scalar from nonce and electionId deterministically or securely
  const seedHash = createHash("sha256").update(`${electionId}:${nonce}:zk-secret`).digest("hex");
  const r: bigint = (BigInt(`0x${seedHash}`) % (q - BigInt(2))) + BigInt(1);

  if (candidateIndex < 0 || m === 0) {
    // Return an invalid statement when the candidate is not in the allowed list
    const fakeCommitment = babyJub.mulPointEscalar(G, r);
    return {
      proof: `zk:rejected:invalid-candidate`,
      valid: false,
      publicStatement: `valid-candidate:invalid`,
      commitment: { x: F.toString(fakeCommitment[0]), y: F.toString(fakeCommitment[1]) },
      challenges: [],
      responses: [],
    };
  }

  // Pedersen Commitment: C = r*G + candidateIndex*H
  const rG = babyJub.mulPointEscalar(G, r);
  const cH = babyJub.mulPointEscalar(H, BigInt(candidateIndex));
  const C = babyJub.addPoint(rG, cH);

  const c_vals: bigint[] = new Array(m);
  const s_vals: bigint[] = new Array(m);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const A_vals: Array<[any, any]> = new Array(m);

  // Honest witness for chosen branch
  const w = randomScalar(q);

  for (let j = 0; j < m; j++) {
    const Pj = subPoint(babyJub, C, babyJub.mulPointEscalar(H, BigInt(j)));
    if (j === candidateIndex) {
      // Honest branch announcement
      A_vals[j] = babyJub.mulPointEscalar(G, w);
    } else {
      // Simulated branches: pick random challenge and response
      c_vals[j] = randomScalar(q);
      s_vals[j] = randomScalar(q);
      const sG = babyJub.mulPointEscalar(G, s_vals[j]);
      const cP = babyJub.mulPointEscalar(Pj, c_vals[j]);
      A_vals[j] = subPoint(babyJub, sG, cP);
    }
  }

  // Fiat-Shamir challenge calculation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hashInputs: any[] = [F.toObject(C[0]), F.toObject(C[1])];
  for (let j = 0; j < m; j++) {
    hashInputs.push(F.toObject(A_vals[j][0]), F.toObject(A_vals[j][1]));
  }
  const ch = BigInt(poseidon.F.toString(poseidon(hashInputs))) % q;

  // Close challenge ring
  let sumOthers = BigInt(0);
  for (let j = 0; j < m; j++) {
    if (j !== candidateIndex) {
      sumOthers = (sumOthers + c_vals[j]) % q;
    }
  }
  c_vals[candidateIndex] = (ch - sumOthers + q) % q;
  s_vals[candidateIndex] = (w + c_vals[candidateIndex] * r) % q;

  const candidateIdsHash = createHash("sha256")
    .update(validCandidateIds.slice().sort().join("|"))
    .digest("hex");

  const proofPayload = JSON.stringify({
    scheme: "babyjubjub-cds-1-of-n",
    electionId,
    candidateIdsHash,
    commitment: [F.toString(C[0]), F.toString(C[1])],
    challenges: c_vals.map((v) => v.toString()),
    responses: s_vals.map((v) => v.toString()),
  });

  const proofString = `zk:babyjub:${Buffer.from(proofPayload).toString("base64url")}`;

  return {
    proof: proofString,
    valid: true,
    publicStatement: `valid-candidate:${proofString}`,
    commitment: { x: F.toString(C[0]), y: F.toString(C[1]) },
    challenges: c_vals.map((v) => v.toString()),
    responses: s_vals.map((v) => v.toString()),
  };
}

/**
 * Verifies the Zero-Knowledge Proof that the ballot commits to one of the valid candidates
 * without revealing which candidate it is.
 */
export async function verifyZkVoteProof({
  electionId,
  proof,
  validCandidateIds,
}: {
  electionId: string;
  proof: ZkVoteProof | string;
  validCandidateIds: string[];
}): Promise<boolean> {
  const m = validCandidateIds.length;
  if (m === 0 || !electionId) return false;

  const rawProofString = typeof proof === "string" ? proof : proof.proof;
  if (!rawProofString || !rawProofString.startsWith("zk:babyjub:")) {
    return false;
  }

  try {
    const jsonStr = Buffer.from(rawProofString.replace("zk:babyjub:", ""), "base64url").toString("utf8");
    const parsed = JSON.parse(jsonStr) as {
      scheme: string;
      electionId: string;
      candidateIdsHash?: string;
      commitment: [string, string];
      challenges: string[];
      responses: string[];
    };

    if (parsed.scheme !== "babyjubjub-cds-1-of-n") return false;
    if (parsed.electionId !== electionId) return false;
    if (parsed.challenges.length !== m || parsed.responses.length !== m) return false;

    if (parsed.candidateIdsHash) {
      const expectedHash = createHash("sha256")
        .update(validCandidateIds.slice().sort().join("|"))
        .digest("hex");
      if (parsed.candidateIdsHash !== expectedHash) return false;
    }

    const { babyJub, poseidon } = await getCrypto();
    const F = babyJub.F;
    const q: bigint = babyJub.order;
    const G = babyJub.Base8;
    const H = getGeneratorH(babyJub);

    const C: [unknown, unknown] = [F.e(parsed.commitment[0]), F.e(parsed.commitment[1])];
    // Ensure C is on BabyJubjub curve
    if (!babyJub.inCurve(C)) return false;

    const c_vals = parsed.challenges.map((c) => BigInt(c));
    const s_vals = parsed.responses.map((s) => BigInt(s));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v_A: Array<[any, any]> = new Array(m);
    let v_sumC = BigInt(0);

    for (let j = 0; j < m; j++) {
      const Pj = subPoint(babyJub, C, babyJub.mulPointEscalar(H, BigInt(j)));
      const sG = babyJub.mulPointEscalar(G, s_vals[j]);
      const cP = babyJub.mulPointEscalar(Pj, c_vals[j]);
      v_A[j] = subPoint(babyJub, sG, cP);
      v_sumC = (v_sumC + c_vals[j]) % q;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v_hashInputs: any[] = [F.toObject(C[0]), F.toObject(C[1])];
    for (let j = 0; j < m; j++) {
      v_hashInputs.push(F.toObject(v_A[j][0]), F.toObject(v_A[j][1]));
    }
    const v_ch = BigInt(poseidon.F.toString(poseidon(v_hashInputs))) % q;

    return v_sumC === v_ch;
  } catch {
    return false;
  }
}
