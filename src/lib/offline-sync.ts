/**
 * VoteChain Phase 13: Offline Ballot Synchronization Engine
 *
 * Coordinates retrieval of pending encrypted votes from persistent IndexedDB,
 * in-memory unsealing, server validation, Sepolia blockchain commitment,
 * receipt recording, and queue completion.
 *
 * Concurrency & Duplicate Protection:
 * - A vote being synchronized is marked "SYNCHRONIZING" to prevent duplicate concurrent dispatches.
 * - If synchronization succeeds, the record is immediately updated to "CONFIRMED".
 * - If the server rejects due to duplicate participation (409), the queue item is marked processed.
 * - If network fails during synchronization, the vote reverts to "QUEUED" for automatic retry.
 */

import {
  type QueuedOfflineVote,
  getPendingVotes,
  updateQueuedVote,
  getQueuedVote,
} from "./offline-storage";
import { decryptBallotOffline } from "./offline-encryption";

export type SyncResult =
  | { ok: true; status: "CONFIRMED"; voteId: string; receiptId: string; txHash: string; blockNumber: number }
  | { ok: false; status: "QUEUED"; networkError: true; error: string }
  | { ok: false; status: "FAILED"; error: string; duplicate?: boolean };

/**
 * Synchronizes a single queued vote item with the VoteChain backend.
 */
export async function synchronizeQueuedVote(
  queuedVote: QueuedOfflineVote,
  options?: { baseUrl?: string; fetchImpl?: typeof fetch },
): Promise<SyncResult> {
  const fetchFn = options?.fetchImpl || (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fetchFn) {
    throw new Error("No fetch implementation available for synchronization.");
  }

  const baseUrl = options?.baseUrl || "";

  // Check network status if in browser
  if (typeof window !== "undefined" && typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      ok: false,
      status: "QUEUED",
      networkError: true,
      error: "Device is currently offline. Vote remains safely queued.",
    };
  }

  // Mark status as SYNCHRONIZING to prevent race conditions
  await updateQueuedVote(queuedVote.id, {
    status: "SYNCHRONIZING",
    lastAttemptAt: new Date().toISOString(),
  });

  // Decrypt candidate choice in memory
  let candidateId: string;
  try {
    candidateId = await decryptBallotOffline(queuedVote);
  } catch (decryptErr) {
    const errorMsg = decryptErr instanceof Error ? decryptErr.message : "Ballot decryption failed.";
    await updateQueuedVote(queuedVote.id, {
      status: "FAILED",
      error: errorMsg,
    });
    return { ok: false, status: "FAILED", error: errorMsg };
  }

  try {
    const endpoint = `${baseUrl}/api/voter/elections/${queuedVote.electionId}/vote`;
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId,
        offlineBuffered: true,
      }),
    });

    const data = await response.json();

    if (response.ok && data.receipt) {
      // SUCCESS: On-chain transaction mined and commitment recorded
      const receiptData = {
        receiptId: data.receipt.receiptId,
        voteId: data.receipt.voteId,
        txHash: data.receipt.txHash,
        blockNumber: Number(data.receipt.blockNumber),
        recordHash: data.receipt.recordHash,
        submittedAt: data.receipt.submittedAt,
        zkVerified: Boolean(data.receipt.zkVerified),
      };

      await updateQueuedVote(queuedVote.id, {
        status: "CONFIRMED",
        receipt: receiptData,
        error: undefined,
      });

      return {
        ok: true,
        status: "CONFIRMED",
        voteId: receiptData.voteId,
        receiptId: receiptData.receiptId,
        txHash: receiptData.txHash,
        blockNumber: receiptData.blockNumber,
      };
    }

    // 409 Conflict: Already voted in this election (One-person-one-vote replay protection)
    if (response.status === 409) {
      const errorMsg = data.error || "You have already cast a ballot in this election.";
      await updateQueuedVote(queuedVote.id, {
        status: "FAILED",
        error: errorMsg,
      });
      return { ok: false, status: "FAILED", duplicate: true, error: errorMsg };
    }

    // Other permanent failures (e.g. 403 ineligible, 404 election not found, 400 closed)
    const errorMsg = data.error || "The server rejected the ballot synchronization.";
    await updateQueuedVote(queuedVote.id, {
      status: "FAILED",
      error: errorMsg,
    });
    return { ok: false, status: "FAILED", error: errorMsg };
  } catch (networkErr) {
    // Network interruption during transmission: revert to QUEUED with backoff
    const errorMsg = networkErr instanceof Error ? networkErr.message : "Network failure during synchronization.";
    const current = await getQueuedVote(queuedVote.id);
    const retryCount = (current?.retryCount || 0) + 1;

    await updateQueuedVote(queuedVote.id, {
      status: "QUEUED",
      error: errorMsg,
      retryCount,
    });

    return {
      ok: false,
      status: "QUEUED",
      networkError: true,
      error: errorMsg,
    };
  }
}

/**
 * Synchronizes all pending queued votes across all elections.
 */
export async function synchronizeAllPendingVotes(
  options?: { baseUrl?: string; fetchImpl?: typeof fetch; onProgress?: (vote: QueuedOfflineVote, result: SyncResult) => void },
): Promise<SyncResult[]> {
  const pending = await getPendingVotes();
  const results: SyncResult[] = [];

  for (const vote of pending) {
    const result = await synchronizeQueuedVote(vote, options);
    results.push(result);
    if (options?.onProgress) {
      options.onProgress(vote, result);
    }
  }

  return results;
}
