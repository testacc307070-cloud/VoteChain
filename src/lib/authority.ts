import { randomBytes } from "node:crypto";

export type AuthorityApproval = {
  authorityId: string;
  approved: boolean;
  keyShare?: string | null;
};

export type AuthorityThresholdResult = {
  approvals: number;
  required: number;
  approved: boolean;
  status: "APPROVED" | "PENDING" | "REJECTED";
  sharesSubmitted: number;
  canReconstructKey: boolean;
};

export type AuthorityReviewStatus = AuthorityThresholdResult & {
  canPublish: boolean;
};

export type KeyShareObject = {
  x: number;
  y: Uint8Array;
};

// Galois Field GF(256) arithmetic with irreducible polynomial 0x11b
const expTable = new Uint8Array(512);
const logTable = new Uint8Array(256);

(function initGfTable() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    expTable[i] = val;
    expTable[i + 255] = val;
    logTable[val] = i;
    val ^= (val << 1) ^ ((val & 0x80) ? 0x11b : 0);
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return expTable[logTable[a] + logTable[b]];
}

function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error("Division by zero in GF(256)");
  if (a === 0) return 0;
  return expTable[(logTable[a] - logTable[b] + 255) % 255];
}

/**
 * Splits a master secret (such as a 32-byte AES ballot decryption key) into n shares
 * with a threshold of k using Shamir's Secret Sharing.
 */
export function splitSecretToShares(secret: string | Buffer, totalShares: number, threshold: number): string[] {
  const secretBytes = typeof secret === "string" ? Buffer.from(secret, "utf8") : secret;
  const n = Math.max(1, Math.min(254, totalShares));
  const k = Math.max(1, Math.min(n, threshold));

  const shares: KeyShareObject[] = Array.from({ length: n }, (_, i) => ({
    x: i + 1,
    y: new Uint8Array(secretBytes.length),
  }));

  for (let byteIdx = 0; byteIdx < secretBytes.length; byteIdx++) {
    const coeffs = [secretBytes[byteIdx]];
    const randoms = randomBytes(k - 1);
    for (let c = 1; c < k; c++) {
      coeffs.push(randoms[c - 1]);
    }

    for (let s = 0; s < n; s++) {
      const xVal = shares[s].x;
      let yVal = 0;
      let xPow = 1;
      for (let c = 0; c < k; c++) {
        yVal ^= gfMul(coeffs[c], xPow);
        xPow = gfMul(xPow, xVal);
      }
      shares[s].y[byteIdx] = yVal;
    }
  }

  return shares.map((share) => `keyshare:${share.x}:${Buffer.from(share.y).toString("base64url")}`);
}

/**
 * Reconstructs the master secret from at least k shares via Lagrange polynomial interpolation.
 */
export function reconstructSecretFromShares(serializedShares: string[], threshold: number): string {
  const parsedShares: KeyShareObject[] = serializedShares
    .filter((s) => s.startsWith("keyshare:"))
    .map((s) => {
      const parts = s.split(":");
      const x = parseInt(parts[1], 10);
      const y = Buffer.from(parts[2], "base64url");
      return { x, y: new Uint8Array(y) };
    });

  const uniqueShares = Array.from(new Map(parsedShares.map((s) => [s.x, s])).values());
  if (uniqueShares.length < threshold) {
    throw new Error(`Insufficient authority key shares. Have ${uniqueShares.length}, need ${threshold}.`);
  }

  const subset = uniqueShares.slice(0, threshold);
  const secretLen = subset[0].y.length;
  const recovered = new Uint8Array(secretLen);

  for (let byteIdx = 0; byteIdx < secretLen; byteIdx++) {
    let sum = 0;
    for (let j = 0; j < threshold; j++) {
      const xj = subset[j].x;
      const yj = subset[j].y[byteIdx];
      let lagrange = 1;
      for (let m = 0; m < threshold; m++) {
        if (m === j) continue;
        const xm = subset[m].x;
        lagrange = gfMul(lagrange, gfDiv(xm, xm ^ xj));
      }
      sum ^= gfMul(yj, lagrange);
    }
    recovered[byteIdx] = sum;
  }

  return Buffer.from(recovered).toString("utf8");
}

export function evaluateAuthorityThreshold(
  approvals: AuthorityApproval[],
  required: number,
): AuthorityThresholdResult {
  const uniqueApprovals = new Map(approvals.map((entry) => [entry.authorityId, entry.approved]));
  const approvalsCount = [...uniqueApprovals.values()].filter(Boolean).length;
  const normalizedRequired = Math.max(1, Math.floor(required));
  const approved = approvalsCount >= normalizedRequired;

  const validShares = approvals
    .filter((entry) => entry.approved && typeof entry.keyShare === "string" && entry.keyShare.startsWith("keyshare:"))
    .map((entry) => entry.keyShare as string);
  const uniqueSharesCount = new Set(validShares.map((s) => s.split(":")[1])).size;

  return {
    approvals: approvalsCount,
    required: normalizedRequired,
    approved,
    status: approved ? "APPROVED" : approvalsCount > 0 ? "PENDING" : "REJECTED",
    sharesSubmitted: uniqueSharesCount,
    canReconstructKey: uniqueSharesCount >= normalizedRequired,
  };
}

export function buildAuthorityReviewStatus(
  approvals: AuthorityApproval[],
  required: number,
): AuthorityReviewStatus {
  const threshold = evaluateAuthorityThreshold(approvals, required);
  return {
    ...threshold,
    canPublish: threshold.approved,
  };
}

export function stringifyAuthorityStatus(result: AuthorityThresholdResult): string {
  return `${result.approvals}/${result.required} authorities approved (${result.sharesSubmitted}/${result.required} shares)`;
}
