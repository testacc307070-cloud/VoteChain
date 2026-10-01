/**
 * VoteChain Phase 13: Persistent Offline Storage
 *
 * Implements durable browser storage using IndexedDB for queuing encrypted ballots
 * during network disruption, ensuring survival across page reloads and browser restarts.
 *
 * Security Invariants:
 * - NO plaintext candidate choices are ever stored in IndexedDB or localStorage.
 * - NO server secrets, private keys, BALLOT_ENCRYPTION_KEY, or authority shares are stored.
 * - Data is scoped to electionId with unique queue item IDs.
 */

export type OfflineVoteStatus = "QUEUED" | "SYNCHRONIZING" | "CONFIRMED" | "FAILED";

export type QueuedOfflineVote = {
  id: string; // Unique UUID for the queue entry
  electionId: string;
  electionName: string;
  // Encrypted ballot payload (AES-256-GCM)
  encryptedBallot: string; // Base64url ciphertext
  nonce: string; // Base64url IV
  authTag: string; // Base64url GCM auth tag
  localKeyEnvelope: string; // Protected ephemeral device envelope
  zkProof?: string; // Client ZK proof commitment (if computed)
  status: OfflineVoteStatus;
  queuedAt: string; // ISO timestamp
  lastAttemptAt?: string;
  error?: string;
  retryCount: number;
  // Receipt populated upon successful on-chain synchronization
  receipt?: {
    receiptId: string;
    voteId: string;
    txHash: string;
    blockNumber: number;
    recordHash: string;
    submittedAt: string;
    zkVerified: boolean;
  };
};

const DB_NAME = "VoteChainOfflineDB";
const DB_VERSION = 1;
const STORE_NAME = "pending_votes";

// In-memory fallback store for Node.js / SSR / non-indexedDB test environments
const memoryStore = new Map<string, QueuedOfflineVote>();

function isIndexedDbAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error("IndexedDB is not available in current environment."));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("electionId", "electionId", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("queuedAt", "queuedAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
  });
}

/**
 * Persists an encrypted ballot into durable IndexedDB storage.
 */
export async function queueOfflineVote(vote: QueuedOfflineVote): Promise<void> {
  if (isIndexedDbAvailable()) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(vote);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error("Failed to store queued vote"));
      tx.oncomplete = () => db.close();
    });
  }

  // Fallback for Node.js / non-browser test runner
  memoryStore.set(vote.id, { ...vote });
}

/**
 * Retrieves all pending (unconfirmed) votes awaiting network synchronization.
 */
export async function getPendingVotes(): Promise<QueuedOfflineVote[]> {
  if (isIndexedDbAvailable()) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as QueuedOfflineVote[]) || [];
        resolve(all.filter((v) => v.status !== "CONFIRMED"));
      };
      req.onerror = () => reject(req.error || new Error("Failed to read pending votes"));
      tx.oncomplete = () => db.close();
    });
  }

  return Array.from(memoryStore.values()).filter((v) => v.status !== "CONFIRMED");
}

/**
 * Retrieves all votes in storage (including confirmed ones for receipt display).
 */
export async function getAllQueuedVotes(): Promise<QueuedOfflineVote[]> {
  if (isIndexedDbAvailable()) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error("Failed to read queued votes"));
      tx.oncomplete = () => db.close();
    });
  }

  return Array.from(memoryStore.values());
}

/**
 * Retrieves a single queued vote by its queue entry ID.
 */
export async function getQueuedVote(id: string): Promise<QueuedOfflineVote | null> {
  if (isIndexedDbAvailable()) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error("Failed to get queued vote"));
      tx.oncomplete = () => db.close();
    });
  }

  return memoryStore.get(id) || null;
}

/**
 * Retrieves a pending vote for a specific election to prevent duplicate local submissions.
 */
export async function getPendingVoteForElection(electionId: string): Promise<QueuedOfflineVote | null> {
  const pending = await getPendingVotes();
  return pending.find((v) => v.electionId === electionId) || null;
}

/**
 * Updates status, error, or confirmed receipt metadata for an existing queue item.
 */
export async function updateQueuedVote(id: string, updates: Partial<QueuedOfflineVote>): Promise<void> {
  if (isIndexedDbAvailable()) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result as QueuedOfflineVote;
        if (!existing) {
          reject(new Error(`Queued vote ${id} not found.`));
          return;
        }
        const updated = { ...existing, ...updates };
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error || new Error("Failed to update queued vote"));
      };
      getReq.onerror = () => reject(getReq.error || new Error("Failed to fetch queued vote for update"));
      tx.oncomplete = () => db.close();
    });
  }

  const existing = memoryStore.get(id);
  if (existing) {
    memoryStore.set(id, { ...existing, ...updates });
  }
}

/**
 * Removes a queued vote from storage (e.g., after user dismissal or test teardown).
 */
export async function removeQueuedVote(id: string): Promise<void> {
  if (isIndexedDbAvailable()) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error("Failed to remove queued vote"));
      tx.oncomplete = () => db.close();
    });
  }

  memoryStore.delete(id);
}

/**
 * Clears the entire offline queue (used in automated tests and cleanup).
 */
export async function clearOfflineQueue(): Promise<void> {
  if (isIndexedDbAvailable()) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error("Failed to clear offline queue"));
      tx.oncomplete = () => db.close();
    });
  }

  memoryStore.clear();
}
