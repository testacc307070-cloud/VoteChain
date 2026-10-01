# How VoteChain Works: Complete Conceptual & Technical Architecture Guide

This document provides a comprehensive technical walkthrough of the **VoteChain** electronic voting system based on the final, deployed, and verified cloud implementation.

---

## 1. System Overview & Deployment Topology

VoteChain operates as a distributed, privacy-preserving electronic voting system across four tiers:

1. **Client Tier (Web Browser)**:
   - Built with **Next.js 16 (App Router)** and **React 19**.
   - Executes client-side **BabyJubjub CDS Zero-Knowledge proofs** and **WebCrypto AES-256-GCM** encryption.
   - Manages durable local offline buffering via **IndexedDB** (`VoteChainOfflineDB`).
2. **Application Server Tier (Vercel Serverless)**:
   - Enforces HMAC-SHA256 signed session cookies, Content Security Policy, and CSRF same-origin guards.
   - Orchestrates Zero-Knowledge proof verification, double-blind database writes, and micro-blockchain block chaining.
   - Manages per-election Data Encryption Keys (DEKs) and 2-of-3 Shamir threshold custody.
3. **Database Tier (Neon PostgreSQL Serverless)**:
   - Relational persistence across 8 Prisma models.
   - Decouples voter identity from encrypted ballots (`ElectionVoterParticipation` vs. `ElectionVote`).
4. **Blockchain Tier (Ethereum Sepolia Testnet)**:
   - Smart contract [`VoteChainLedger.sol`](contracts/VoteChainLedger.sol) deployed at `0x7339F8B088A2835F26e158c9F96690395D80264D`.
   - Sponsored by a server-side relayer (`0xd9f43Cd01A317849e54DbcCB03380dA3EDE5E063`) so voters need zero cryptocurrency or Web3 wallet setup.

---

## 2. Step-by-Step Lifecycle: From Registration to Certified Tally

```
[ Step 1: Registration & Institutional Verification ]
  Voter submits Student ID (24CS001) + @psgtech.ac.in email + password
  Server hashes password with Bcrypt (12 rounds) & sends 15-minute token via Gmail SMTP
  Voter clicks verification link ──> account marked ACTIVE & emailVerified = true

[ Step 2: Election Management & Eligibility Whitelisting ]
  Admin creates election ──> Generates 256-bit DEK & splits into 3 Shamir shares
  Admin uploads official class CSV register ──> ElectionEligibleVoter populated
  Election state advances: CREATED ──> ACTIVE

[ Step 3: Candidate Selection & Local Encryption ]
  Voter opens ballot box at /portal
  ONLINE MODE: Generates BabyJubjub CDS ZK Proof ──> Encrypts with AES-256-GCM
  OFFLINE MODE: Encrypts with WebCrypto AES-GCM + PBKDF2 envelope ──> Saved to IndexedDB

[ Step 4: Submission & Zero-Knowledge Verification ]
  Server verifies BabyJubjub CDS Disjunctive Schnorr proof using Poseidon hash
  Confirms choice is valid candidate in {C1, ..., Cm} without revealing which one

[ Step 5: Double-Blind Database Commitment & Micro-Blockchain Append ]
  Atomic transaction:
  • ElectionVoterParticipation records: (electionId, voterId, votedAt)
  • ElectionVote records: (encryptedBallot, nonce, authTag, proof, candidateId = null)
  • Micro-blockchain ledger appends block referencing previous block hash

[ Step 6: Ethereum Sepolia Blockchain Mining ]
  Relayer computes commitment = Keccak256(ciphertext : zkProof)
  Calls recordVote(electionId, commitment) on Sepolia smart contract
  Contract enforces require(!commitmentUsed[commitment]) ──> Transaction mined in block

[ Step 7: Cryptographic Receipt Issuance ]
  Voter receives receipt: (receiptId, recordHash, txHash, blockNumber)
  recordHash = SHA-256(electionId : voteId : submittedAt)

[ Step 8: Election Closure & Mandatory 2-of-3 Authority Threshold ]
  Admin sets election status to CLOSED
  Tallying is locked until 2 of 3 designated trustee authorities submit their key shares
  Server executes Lagrange polynomial interpolation over GF(256)
  Reconstructed DEK validated against election keyCommitment

[ Step 9: Anonymous Ballot Decryption & Certified Results ]
  Server decrypts all ElectionVote rows in memory using reconstructed DEK
  Candidate totals tallied without any voter identity linkage
  Certified results published to /results

[ Step 10: Public Receipt & Merkle Tree Inclusion Verification ]
  Balanced SHA-256 Merkle tree constructed over all vote hashes
  Any voter or citizen opens /verify without login to verify Merkle inclusion proof
```

---

## 3. Deep Dive: Core Cryptographic & Security Mechanisms

### 3.1 Student Registration & Email Verification
- **Institutional Domain Requirement**: Registration strictly requires the `@psgtech.ac.in` domain (`src/lib/auth-validation.ts`).
- **Student ID Format**: Validated against PSG Tech standard convention (2-digit admission year + 2-letter branch code + 3-digit roll number, e.g. `24CS001`).
- **Single-Use Verification Token**:
  - A cryptographically random 32-byte hex token is generated.
  - The SHA-256 hash of the token is stored in the `VerificationToken` table with a 15-minute expiration timestamp.
  - Verification emails are dispatched via Gmail SMTP (`votechain.verify@gmail.com`).
  - Upon clicking the link, the token is verified, marked `usedAt = now()`, and the user's `emailVerified` flag is set to `true`. Expired or reused tokens are strictly rejected.

### 3.2 Double-Blind Database Secrecy
VoteChain physically decouples voter identity from the ballot choice in the database schema:
1. **`ElectionVoterParticipation`**:
   - Schema: `(id, electionId, voterId, votedAt, createdAt)`
   - Unique constraint: `@@unique([electionId, voterId])`
   - Purpose: Enforces one-person-one-vote and prevents double voting. Contains **zero reference** to candidate choice, vote ID, or receipt ID.
2. **`ElectionVote`**:
   - Schema: `(id, electionId, encryptedBallot, ballotNonce, ballotAuthTag, ballotProof, zkProof, receiptId, txHash, blockNumber, candidateId = null)`
   - Purpose: Stores the anonymous encrypted ballot. `candidateId` is strictly `null` (anonymized). There are **no foreign keys or correlation columns** linking an `ElectionVote` record back to a `User` or `ElectionVoterParticipation` row.

### 3.3 Zero-Knowledge Proofs (BabyJubjub CDS Schnorr NIZKP)
To prevent ballot manipulation without compromising voter secrecy, VoteChain uses a Cramer-Damgård-Schoenmakers (CDS) 1-of-$N$ Disjunctive Non-Interactive Zero-Knowledge Proof on the twisted Edwards **BabyJubjub curve** with the **Poseidon hash function** (`src/lib/zk-proof.ts`):
- For valid candidate public keys $P_1, P_2, \dots, P_m$:
  - For the voter's chosen candidate $k$, a real Schnorr announcement is computed: $A_k = r \cdot G$.
  - For each non-selected candidate $i \neq k$, simulated announcements and responses are generated: $A_i = s_i \cdot G + c_i \cdot P_i$.
  - The Fiat-Shamir challenge is computed: $ch = \text{Poseidon}(P_1, \dots, P_m, A_1, \dots, A_m)$.
  - The real challenge is derived: $c_k = ch - \sum_{i \neq k} c_i \pmod q$.
  - The response is computed: $s_k = r + c_k \cdot x \pmod q$.
- **Verification**: The verifier verifies $\sum c_i = ch \pmod q$ and $s_i \cdot G + c_i \cdot P_i = A_i$ for all $i$. The verifier confirms that the vote is a valid candidate selection while mathematically learning zero bits of information about which candidate was selected.

### 3.4 Per-Election DEK & 2-of-3 Shamir Threshold Key Custody
- **Per-Election Key**: Every election generates a unique 256-bit cryptographically random Data Encryption Key (DEK). A SHA-256 commitment of the key is stored on `Election.keyCommitment`.
- **Shamir's Secret Sharing over $\text{GF}(256)$**:
  - The 32-byte DEK is split into 3 shares using high-entropy polynomials over Galois Field $\text{GF}(2^8)$ with irreducible polynomial $P(x) = x^8 + x^4 + x^3 + x + 1$ (`0x11b`).
  - Shares are serialized as `keyshare:<electionId>:<x>:<y_base64url>`.
  - Exactly one share is assigned to each of 3 designated trustee authorities.
- **Mandatory Threshold Reconstruction**:
  - Decryption is completely locked while the election is active.
  - When the election closes, authorities submit their key shares.
  - Reconstructing the DEK requires at least 2 distinct valid authority shares via Lagrange interpolation over $\text{GF}(256)$:
    $$S = \sum_{j=1}^{k} y_j \prod_{m \neq j} \frac{x_m}{x_m \oplus x_j}$$
  - The reconstructed key must match the SHA-256 `keyCommitment`.
  - 0 shares, 1 share, duplicate shares (A+A), tampered shares, and wrong-election shares are strictly rejected.

### 3.5 Real Persistent Offline Voting (Phase 13 Engine)
VoteChain includes a durable client-side offline voting engine (`src/lib/offline-storage.ts`, `src/lib/offline-encryption.ts`, `src/lib/offline-sync.ts`):
1. **Network Disruption Detection**: Real `navigator.onLine` checks and `online`/`offline` window events.
2. **Local Device Encryption**: When offline, the ballot is encrypted locally via the browser's native **WebCrypto AES-256-GCM** API. The ephemeral encryption key is sealed in a local envelope using PBKDF2 with SHA-256 derived from the device salt and election ID (`localKeyEnvelope`).
3. **Durable Persistence**: The encrypted vote is stored in browser **IndexedDB** (`VoteChainOfflineDB`, object store `pending_votes`). It survives page reloads, tab closures, and browser restarts.
4. **Zero Confidentiality Leakage**: Zero plaintext candidate choices or server secrets are stored on disk.
5. **Auto-Synchronization**: When internet connectivity returns, the background synchronizer unseals the ballot in memory, submits it to the backend, verifies the ZK proof, mines it to Ethereum Sepolia, receives the real receipt, and marks the local queue status as `CONFIRMED`.
6. **Replay Protection**: If a synchronized vote is submitted again, the server rejects it with HTTP 409 Conflict (`ALREADY_VOTED`).

### 3.6 Micro-Blockchain & Ethereum Sepolia Dual-Ledger
VoteChain maintains a dual-ledger architecture:
1. **Internal Micro-Blockchain**:
   - Stored in the `ElectionBlockchainBlock` table.
   - Every vote appends a block linking to the previous block hash:
     $$\text{hash} = \text{SHA-256}(\text{index} : \text{timestamp} : \text{previousHash} : \text{payload})$$
   - Continuous chain integrity is audited in the Observer Dashboard (`/observer`).
2. **Ethereum Sepolia Smart Contract**:
   - Smart contract `VoteChainLedger.sol` on Ethereum Sepolia.
   - Commitment: $\text{commitment} = \text{Keccak-256}(\text{ciphertext} : \text{zkProof})$.
   - Enforces on-chain replay protection via `commitmentUsed[commitment]`.
   - Once mined, the transaction hash and block number are embedded in the voter's receipt.

### 3.7 Balanced SHA-256 Merkle Inclusion Proofs
- When an election closes and tallies are finalized, all cast ballot commitments are arranged as the leaves of a balanced binary SHA-256 Merkle tree (`src/lib/integrity.ts`).
- The Merkle root is calculated and published.
- Any voter can enter their receipt ID at `/verify` to receive a logarithmic inclusion proof:
  - The verifier hashes the voter's receipt along the sibling hash path:
    $$H_{\text{parent}} = \text{SHA-256}(H_{\text{left}} : H_{\text{right}})$$
  - If the computed hash matches the certified Merkle root, it proves mathematically that the voter's ballot was included in the official tally without revealing the voter's candidate selection.

---

## 4. Implementation Status Matrix

| Component | Status | Production Implementation Details |
| :--- | :--- | :--- |
| **Institutional Email Verification** | **Production** | `@psgtech.ac.in` validation, Gmail SMTP, single-use 15m tokens (`src/lib/registration.ts`). |
| **Authentication & Role Guards** | **Production** | Bcrypt (12 rounds), HMAC session cookies, 4 role guards (`src/lib/role-routing.ts`). |
| **Cloud PostgreSQL Database** | **Production** | Neon Serverless PostgreSQL with Prisma Client 6.12.0 and connection pooling. |
| **Vercel Cloud Deployment** | **Production** | Next.js 16.3.6 App Router, Turbopack, production security headers, CSRF origin checks. |
| **Double-Blind Secrecy** | **Production** | Physical database separation between participation and anonymous encrypted ballots. |
| **Per-Election DEK Architecture** | **Production** | Unique 256-bit random key per election + SHA-256 key commitment (`src/lib/election-keys.ts`). |
| **2-of-3 Threshold Authority Custody** | **Production** | Shamir $\text{GF}(256)$ sharing, 3 trustees, mandatory 2-of-3 quorum for tallies (`src/lib/authority.ts`). |
| **Zero-Knowledge Proofs** | **Production** | BabyJubjub CDS 1-of-$N$ Schnorr NIZKP with Poseidon hashing via `circomlibjs` (`src/lib/zk-proof.ts`). |
| **Ethereum Sepolia Blockchain** | **Production** | `VoteChainLedger.sol` on Sepolia testnet at `0x7339F8B088A2835F26e158c9F96690395D80264D`. |
| **Persistent Offline Voting** | **Production** | Client-side IndexedDB queue, WebCrypto AES-256-GCM, auto-sync upon `online` event. |
| **Merkle Universal Verifiability** | **Production** | Balanced SHA-256 Merkle tree, inclusion proof generator, public verifier (`/verify`). |
| **Micro-Blockchain Ledger** | **Production** | Chained block audit trail, SHA-256 previousHash links, tamper detection simulation (`/observer`). |

---

## 5. Summary

VoteChain implements an end-to-end verifiable classroom electronic voting system that combines Zero-Knowledge proofs, double-blind database architecture, multi-authority threshold cryptography, Ethereum Sepolia blockchain commitments, and persistent offline recovery into a unified, open-source stack.
