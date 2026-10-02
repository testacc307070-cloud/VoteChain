import { createHash, createHmac, randomBytes } from "node:crypto";

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
  electionId?: string;
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
 * Splits a master secret into n shares with a threshold of k using Shamir's Secret Sharing.
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
 * Phase 9.2: Splits a specific election's Data Encryption Key (DEK) into n shares with threshold k.
 * Uses high-entropy deterministic pseudorandom polynomials keyed by the DEK and bound to electionId
 * so that all designated authorities receive consistent shares for that election.
 */
export function splitElectionSecret(
  electionId: string,
  secret: string | Buffer,
  totalShares: number = 3,
  threshold: number = 2,
): string[] {
  const secretBytes = typeof secret === "string" ? Buffer.from(secret, "utf8") : secret;
  const n = Math.max(1, Math.min(254, totalShares));
  const k = Math.max(1, Math.min(n, threshold));

  const shares: KeyShareObject[] = Array.from({ length: n }, (_, i) => ({
    electionId,
    x: i + 1,
    y: new Uint8Array(secretBytes.length),
  }));

  for (let byteIdx = 0; byteIdx < secretBytes.length; byteIdx++) {
    const coeffs = [secretBytes[byteIdx]];
    for (let c = 1; c < k; c++) {
      const hmac = createHmac("sha256", secretBytes)
        .update(`${electionId}:poly:${c}:${Math.floor(byteIdx / 32)}`)
        .digest();
      coeffs.push(hmac[byteIdx % 32]);
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

  return shares.map((share) => `keyshare:${electionId}:${share.x}:${Buffer.from(share.y).toString("base64url")}`);
}

/**
 * Parses a serialized Shamir key share string. Supports both 4-part (election-bound) and 3-part (legacy).
 */
export function parseKeyShare(serialized: string): KeyShareObject {
  if (typeof serialized !== "string" || !serialized.startsWith("keyshare:")) {
    throw new Error("Invalid key share format: must start with 'keyshare:'.");
  }

  const parts = serialized.split(":");
  if (parts.length === 4) {
    // keyshare:electionId:x:base64url(y)
    const electionId = parts[1];
    const x = parseInt(parts[2], 10);
    const y = Buffer.from(parts[3], "base64url");
    if (isNaN(x) || x < 1 || x > 255 || y.length === 0) {
      throw new Error("Invalid key share encoding or coordinate.");
    }
    return { electionId, x, y: new Uint8Array(y) };
  } else if (parts.length === 3) {
    // Legacy: keyshare:x:base64url(y)
    const x = parseInt(parts[1], 10);
    const y = Buffer.from(parts[2], "base64url");
    if (isNaN(x) || x < 1 || x > 255 || y.length === 0) {
      throw new Error("Invalid key share encoding or coordinate.");
    }
    return { x, y: new Uint8Array(y) };
  } else {
    throw new Error(`Malformed key share: expected 3 or 4 segments, got ${parts.length}.`);
  }
}

/**
 * Reconstructs the master secret from at least k shares via Lagrange polynomial interpolation.
 * If expectedElectionId is provided, shares from other elections are strictly rejected.
 */
export function reconstructSecretFromShares(
  serializedShares: string[],
  threshold: number,
  expectedElectionId?: string,
): string {
  const parsedShares: KeyShareObject[] = [];
  for (const s of serializedShares) {
    if (!s || typeof s !== "string" || !s.startsWith("keyshare:")) continue;
    const parsed = parseKeyShare(s);
    if (expectedElectionId && parsed.electionId && parsed.electionId !== expectedElectionId) {
      throw new Error(
        `Wrong-election share rejected: share belongs to election "${parsed.electionId}", not "${expectedElectionId}".`,
      );
    }
    parsedShares.push(parsed);
  }

  // Deduplicate by x-coordinate: duplicate shares from the same authority or coordinate count only once
  const uniqueShares = Array.from(new Map(parsedShares.map((s) => [s.x, s])).values());
  if (uniqueShares.length < threshold) {
    throw new Error(`Insufficient authority key shares. Have ${uniqueShares.length}, need ${threshold}.`);
  }

  const subset = uniqueShares.slice(0, threshold);
  const secretLen = subset[0].y.length;

  for (let i = 1; i < threshold; i++) {
    if (subset[i].y.length !== secretLen) {
      throw new Error("Key share length mismatch: shares were generated from different secrets or corrupted.");
    }
  }

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

/**
 * Phase 9.2: Reconstructs an election DEK and validates it against the election's keyCommitment.
 * Throws immediately if shares are insufficient, from the wrong election, or tampered.
 */
export function reconstructAndValidateElectionKey({
  electionId,
  keyCommitment,
  shares,
  threshold = 2,
}: {
  electionId: string;
  keyCommitment?: string | null;
  shares: string[];
  threshold?: number;
}): string {
  const recoveredKey = reconstructSecretFromShares(shares, threshold, electionId);

  if (keyCommitment) {
    const computedCommitment = `sha256:${createHash("sha256").update(recoveredKey).digest("hex")}`;
    if (computedCommitment !== keyCommitment) {
      throw new Error(
        "Reconstructed key does not match election keyCommitment! Share tampering or invalid threshold reconstruction detected.",
      );
    }
  }

  return recoveredKey;
}

export function evaluateAuthorityThreshold(
  approvals: AuthorityApproval[],
  required: number,
  expectedElectionId?: string,
): AuthorityThresholdResult {
  const uniqueApprovals = new Map(approvals.map((entry) => [entry.authorityId, entry.approved]));
  const approvalsCount = [...uniqueApprovals.values()].filter(Boolean).length;
  const normalizedRequired = Math.max(1, Math.floor(required));
  const approved = approvalsCount >= normalizedRequired;

  const validShares: KeyShareObject[] = [];
  for (const entry of approvals) {
    if (entry.approved && typeof entry.keyShare === "string" && entry.keyShare.startsWith("keyshare:")) {
      try {
        const parsed = parseKeyShare(entry.keyShare);
        if (expectedElectionId && parsed.electionId && parsed.electionId !== expectedElectionId) {
          continue;
        }
        validShares.push(parsed);
      } catch {
        // malformed share ignored
      }
    }
  }

  // Deduplicate by x-coordinate
  const uniqueXCount = new Set(validShares.map((s) => s.x)).size;

  return {
    approvals: approvalsCount,
    required: normalizedRequired,
    approved,
    status: approved ? "APPROVED" : approvalsCount > 0 ? "PENDING" : "REJECTED",
    sharesSubmitted: uniqueXCount,
    canReconstructKey: uniqueXCount >= normalizedRequired,
  };
}

export function buildAuthorityReviewStatus(
  approvals: AuthorityApproval[],
  required: number,
  expectedElectionId?: string,
): AuthorityReviewStatus {
  const threshold = evaluateAuthorityThreshold(approvals, required, expectedElectionId);
  return {
    ...threshold,
    canPublish: threshold.approved,
  };
}

export function stringifyAuthorityStatus(result: AuthorityThresholdResult): string {
  return `${result.approvals}/${result.required} authorities approved (${result.sharesSubmitted}/${result.required} shares)`;
}

/**
 * Convenience helper to reconstruct an election secret from shares with threshold enforcement.
 */
export function reconstructElectionSecret(
  electionId: string,
  shares: string[],
  threshold: number = 2
): string {
  return reconstructSecretFromShares(shares, threshold, electionId);
}

