import { createHmac } from "node:crypto";

const OBSERVER_SECRET = process.env.SESSION_SECRET || "votechain-observer-auth-secret";

/**
 * Creates a cryptographically signed session token for an observer.
 * Scoped to the specific election and the current access code hash.
 * If the administrator revokes or regenerates the access code, the hash changes
 * and all existing tokens are instantly invalidated.
 */
export function createObserverSessionToken(electionId: string, accessCodeHash: string): string {
  // 24-hour time window slot
  const timeSlot = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  return createHmac("sha256", OBSERVER_SECRET)
    .update(`obs:${electionId}:${accessCodeHash}:${timeSlot}`)
    .digest("hex");
}

/**
 * Validates an observer session token against the election's active access code hash.
 * Returns false if the code was revoked (null) or token is invalid/expired.
 */
export function verifyObserverSessionToken(
  token: string,
  electionId: string,
  currentAccessCodeHash: string | null | undefined
): boolean {
  if (!token || !electionId || !currentAccessCodeHash) {
    return false;
  }

  const currentSlot = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  // Allow current 24-hour window and previous window to handle rollover gracefully
  for (let slotOffset = 0; slotOffset <= 1; slotOffset++) {
    const slot = currentSlot - slotOffset;
    const expected = createHmac("sha256", OBSERVER_SECRET)
      .update(`obs:${electionId}:${currentAccessCodeHash}:${slot}`)
      .digest("hex");
    if (token === expected) {
      return true;
    }
  }

  return false;
}
