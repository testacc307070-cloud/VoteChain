/**
 * VoteChain Phase 13: Client-Side Offline Ballot Encryption & Envelope Protection
 *
 * Provides cryptographic protection for votes queued on a voter's device while offline.
 * Uses AES-256-GCM via standard WebCrypto (crypto.subtle) with ephemeral key generation
 * and authenticated additional data (AAD) binding to the specific electionId.
 *
 * Security Invariants:
 * - The candidateId is NEVER stored in plaintext.
 * - An ephemeral AES-256-GCM key is generated per ballot.
 * - The key is sealed inside an election-bound local device envelope.
 * - Tampering with ciphertext, authTag, nonce, or electionId causes immediate decryption failure.
 * - No server secrets, DEKs, or authority shares are required on the client device.
 */

import { type QueuedOfflineVote } from "./offline-storage";

function getCryptoSubtle(): SubtleCrypto {
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error("WebCrypto (crypto.subtle) is not available in current runtime.");
}

function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBuffer(base64url: string): Uint8Array {
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derives a deterministic local wrapping key bound to the election ID and device salt
 * using PBKDF2 with SHA-256.
 */
async function deriveLocalWrapKey(electionId: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = getCryptoSubtle();
  const baseKeyMaterial = await subtle.importKey(
    "raw",
    new TextEncoder().encode(`VoteChainDeviceKey:${electionId}`),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations: 10000,
      hash: "SHA-256",
    },
    baseKeyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export type OfflineEncryptParams = {
  electionId: string;
  electionName: string;
  candidateId: string;
  zkProof?: string;
};

/**
 * Encrypts a voter's candidate selection locally using AES-256-GCM.
 * Produces a secure QueuedOfflineVote object with ZERO plaintext candidate info.
 */
export async function encryptBallotOffline({
  electionId,
  electionName,
  candidateId,
  zkProof,
}: OfflineEncryptParams): Promise<QueuedOfflineVote> {
  const subtle = getCryptoSubtle();

  // 1. Generate an ephemeral 256-bit AES ballot encryption key
  const ephemeralKey = await subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, // extractable so we can seal it in the local device envelope
    ["encrypt", "decrypt"],
  );

  // 2. Encrypt candidateId with AES-256-GCM and electionId as Authenticated Additional Data (AAD)
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(electionId);
  const plaintext = new TextEncoder().encode(candidateId);

  const encryptedData = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: aad,
      tagLength: 128,
    },
    ephemeralKey,
    plaintext,
  );

  // WebCrypto AES-GCM appends the 16-byte tag to the ciphertext
  const combined = new Uint8Array(encryptedData);
  const ciphertextBytes = combined.subarray(0, combined.length - 16);
  const tagBytes = combined.subarray(combined.length - 16);

  // 3. Seal ephemeral key in local device envelope
  const rawEphemeralKey = await subtle.exportKey("raw", ephemeralKey);
  const envelopeSalt = crypto.getRandomValues(new Uint8Array(16));
  const envelopeWrapKey = await deriveLocalWrapKey(electionId, envelopeSalt);
  const envelopeIv = crypto.getRandomValues(new Uint8Array(12));

  const sealedKey = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv: envelopeIv,
      additionalData: aad,
      tagLength: 128,
    },
    envelopeWrapKey,
    rawEphemeralKey,
  );

  const envelopePayload = `${bufferToBase64Url(envelopeSalt)}.${bufferToBase64Url(envelopeIv)}.${bufferToBase64Url(sealedKey)}`;

  // 4. Return QueuedOfflineVote with zero plaintext choice
  const id = crypto.randomUUID();
  return {
    id,
    electionId,
    electionName,
    encryptedBallot: `enc:aes-256-gcm:${bufferToBase64Url(ciphertextBytes)}`,
    nonce: bufferToBase64Url(iv),
    authTag: bufferToBase64Url(tagBytes),
    localKeyEnvelope: envelopePayload,
    zkProof,
    status: "QUEUED",
    queuedAt: new Date().toISOString(),
    retryCount: 0,
  };
}

/**
 * Decrypts a locally queued ballot in memory at synchronization time.
 * Throws immediately if data was tampered with or bound to a different electionId.
 */
export async function decryptBallotOffline(vote: QueuedOfflineVote): Promise<string> {
  const subtle = getCryptoSubtle();
  const aad = new TextEncoder().encode(vote.electionId);

  // 1. Unseal local key envelope
  const [saltB64, envIvB64, sealedKeyB64] = vote.localKeyEnvelope.split(".");
  if (!saltB64 || !envIvB64 || !sealedKeyB64) {
    throw new Error("Invalid or corrupted local key envelope.");
  }

  const envelopeSalt = base64UrlToBuffer(saltB64);
  const envelopeIv = base64UrlToBuffer(envIvB64);
  const sealedKey = base64UrlToBuffer(sealedKeyB64);

  const envelopeWrapKey = await deriveLocalWrapKey(vote.electionId, envelopeSalt);
  let rawEphemeralKey: ArrayBuffer;
  try {
    rawEphemeralKey = await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: envelopeIv as unknown as BufferSource,
        additionalData: aad as unknown as BufferSource,
        tagLength: 128,
      },
      envelopeWrapKey,
      sealedKey as unknown as BufferSource,
    );
  } catch {
    throw new Error("Failed to unseal local ballot envelope: tampering or election mismatch detected.");
  }

  // 2. Import unsealed ephemeral key
  const ephemeralKey = await subtle.importKey("raw", rawEphemeralKey, "AES-GCM", false, ["decrypt"]);

  // 3. Reconstruct ciphertext + auth tag
  const rawCiphertextB64 = vote.encryptedBallot.replace(/^enc:aes-256-gcm:/, "");
  const ciphertextBytes = base64UrlToBuffer(rawCiphertextB64);
  const tagBytes = base64UrlToBuffer(vote.authTag);
  const iv = base64UrlToBuffer(vote.nonce);

  const combined = new Uint8Array(ciphertextBytes.length + tagBytes.length);
  combined.set(ciphertextBytes, 0);
  combined.set(tagBytes, ciphertextBytes.length);

  // 4. Decrypt candidateId
  try {
    const decryptedBytes = await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as unknown as BufferSource,
        additionalData: aad as unknown as BufferSource,
        tagLength: 128,
      },
      ephemeralKey,
      combined as unknown as BufferSource,
    );
    return new TextDecoder().decode(decryptedBytes);
  } catch {
    throw new Error("Ballot decryption authentication failed: ciphertext or tag has been tampered with.");
  }
}
