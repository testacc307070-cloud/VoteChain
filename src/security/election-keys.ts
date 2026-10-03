import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Returns the Server-side Key Encryption Key (KEK) used to encrypt per-election
 * Data Encryption Keys (DEKs) at rest.
 * Derived from BALLOT_ENCRYPTION_KEY (or optional KEY_ENCRYPTION_KEY).
 */
export function getServerKek(): Buffer {
  const source = process.env.KEY_ENCRYPTION_KEY || process.env.BALLOT_ENCRYPTION_KEY;
  if (!source || source.length < 32) {
    throw new Error("BALLOT_ENCRYPTION_KEY must contain at least 32 characters.");
  }
  return createHash("sha256").update(source).digest();
}

export type ElectionKeyEnvelope = {
  rawKey: string;
  encryptedMasterKey: string;
  keyCommitment: string;
};

/**
 * Generates a fresh, cryptographically secure 256-bit AES master key for a specific election.
 *
 * Security Architecture Notice (Phase 9.1):
 * - rawKey is a unique per-election 256-bit key generated in server memory.
 * - encryptedMasterKey is an AES-256-GCM envelope stored safely at rest in PostgreSQL.
 * - keyCommitment is an immutable SHA-256 commitment of the raw key.
 *
 * NOTE: The server retains envelope-decryption capability via its server-side KEK during
 * the active voting period to encrypt voter ballots. This provides per-election key isolation
 * but does not yet constitute out-of-band client-held trustee custody.
 */
export function generateElectionKey(): ElectionKeyEnvelope {
  const kek = getServerKek();
  // Generate 32 cryptographically random bytes (256-bit)
  const rawKey = randomBytes(32).toString("hex");
  const keyCommitment = `sha256:${createHash("sha256").update(rawKey).digest("hex")}`;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const ciphertext = Buffer.concat([cipher.update(rawKey, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const encryptedMasterKey = `kek:aes-256-gcm:${iv.toString("base64url")}:${authTag.toString("base64url")}:${ciphertext.toString("base64url")}`;

  return {
    rawKey,
    encryptedMasterKey,
    keyCommitment,
  };
}

export type ElectionKeyResolutionOptions = {
  purpose?: "vote_encryption" | "authority_share_generation" | "results_tally";
};

/**
 * Identifies whether an election is a legacy/historical prototype election (e.g. Phase 8)
 * that does not possess a per-election envelope.
 */
export function isLegacyElection(
  election?: {
    encryptedMasterKey?: string | null;
  } | null,
): boolean {
  return !election || !election.encryptedMasterKey;
}

/**
 * Resolves the 256-bit encryption key for an election.
 * - For active voting: decrypts the per-election DEK envelope via server KEK.
 * - For results tallying on Phase 9+ elections: FORBIDDEN! Results must be decrypted
 *   exclusively via reconstructed 2-of-3 authority shares.
 * - For legacy elections: allows backwards-compatible resolution.
 */
export function getElectionEncryptionKey(
  election?: {
    encryptedMasterKey?: string | null;
    keyCommitment?: string | null;
  } | null,
  options?: ElectionKeyResolutionOptions,
): string {
  // If an election is modern (has per-election DEK envelope)
  if (election?.encryptedMasterKey && election.encryptedMasterKey.startsWith("kek:aes-256-gcm:")) {
    // Phase 9.3 Hard Rule: Direct master key bypass is strictly forbidden for results tallying
    if (options?.purpose === "results_tally") {
      throw new Error(
        "Direct master key resolution is forbidden for results tallying. Results must be decrypted exclusively using 2-of-3 reconstructed authority shares.",
      );
    }

    const kek = getServerKek();
    const parts = election.encryptedMasterKey.split(":");
    if (parts.length === 5) {
      const iv = Buffer.from(parts[2], "base64url");
      const authTag = Buffer.from(parts[3], "base64url");
      const ciphertext = Buffer.from(parts[4], "base64url");

      const decipher = createDecipheriv("aes-256-gcm", kek, iv);
      decipher.setAuthTag(authTag);
      const rawKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");

      // Verify commitment integrity
      if (election.keyCommitment) {
        const expectedCommitment = `sha256:${createHash("sha256").update(rawKey).digest("hex")}`;
        if (election.keyCommitment !== expectedCommitment) {
          throw new Error("Election master key commitment mismatch! Key tampering detected.");
        }
      }

      return rawKey;
    }
  }

  // Modern election record corrupted (keyCommitment present but envelope missing)
  if (election && election.keyCommitment && !election.encryptedMasterKey) {
    throw new Error("Corrupted election: keyCommitment exists but encryptedMasterKey envelope is missing.");
  }

  // Graceful fallback to BALLOT_ENCRYPTION_KEY ONLY for legacy/test elections without per-election envelope
  const fallback = process.env.BALLOT_ENCRYPTION_KEY;
  if (!fallback || fallback.length < 32) {
    throw new Error("BALLOT_ENCRYPTION_KEY must contain at least 32 characters.");
  }
  return fallback;
}
