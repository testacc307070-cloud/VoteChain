# How VoteChain Works: Complete Conceptual & Technical Architecture Guide

This document describes the implementation and current workflows in the **VoteChain educational voting prototype**. Deployment or test history recorded elsewhere is historical evidence, not a certification of the current build.

---

## 1. System Overview & Deployment Topology

VoteChain operates as a distributed, privacy-preserving electronic voting system across four tiers:

1. **Client Tier (Web Browser)**:
   - Built with **Next.js 16 (App Router)** and **React 19**.
   - Executes client-side **BabyJubjub CDS Zero-Knowledge proofs** and **WebCrypto AES-256-GCM** encryption.
   - Manages durable local offline buffering via **IndexedDB** (`VoteChainOfflineDB`).
2. **Application Server Tier (Vercel Serverless)**:
   - Uses HMAC-signed HTTP-only session cookies, role checks, CSRF origin checks, and configured security headers.
   - Orchestrates proof verification, encrypted ballot persistence, participation tracking, and micro-ledger block chaining.
   - Implements per-election encryption keys and a 2-of-3 trustee approval/share workflow for tally authorization.
3. **Database Tier (Neon PostgreSQL Serverless)**:
   - PostgreSQL persistence through Prisma for users, elections, eligibility, participation, votes, trustees, and audit records.
   - Participation has its own one-vote-per-election constraint. The vote schema also has optional voter/candidate relations for application and historical compatibility, so it is not accurate to claim that the database makes all ballots un-linkable.
4. **Blockchain Tier (Ethereum Sepolia Testnet)**:
   - The Solidity [`VoteChainLedger.sol`](../contracts/VoteChainLedger.sol) contract records vote commitments on Ethereum Sepolia.
   - Server-side RPC/relayer settings are configured through environment variables; voters do not need individual wallets.

---

## 2. Step-by-Step Lifecycle: From Registration to Certified Tally

```
Admin prepares and activates election
  ├─ Create election, candidates and schedule
  ├─ Import election-specific eligibility CSV
  ├─ Invite/activate authority accounts and assign trustees
  └─ Configure scoped observer access

Voter registers and verifies email
  └─ Server checks account and election-specific eligibility

Voter submits ballot
  ├─ Online: encrypted ballot + validity proof -> server checks -> database + Sepolia commitment
  └─ Offline: locally encrypted IndexedDB queue -> pending until later server acceptance

After an accepted submission
  ├─ Participation constraint blocks a second accepted vote in that election
  ├─ Transaction details and receipt become available; voter may download PDF
  └─ Micro-ledger and public verification data support integrity checks

Election closes
  ├─ Distinct trustee approvals/shares authorize tallying for a modern election
  ├─ Administrator reviews and publishes the results
  └─ Official candidate totals are shown on /results only after publication

Observers
  ├─ Election-scoped access code: /observe
  └─ Authenticated observer role: /observer
```

The exact status transitions are controlled by the administrator UI and API. A closed election is not necessarily a published-results election.

Election schedule inputs are interpreted as Indian Standard Time (IST, `Asia/Kolkata`) and converted to UTC instants for storage. Election, audit, and observer timestamps are rendered in IST. After publication, a tie for the highest candidate vote count is reported as “No Result”; the application does not select a winner in a tie.

---

## 3. Deep Dive: Core Cryptographic & Security Mechanisms

### 3.1 Registration, eligibility, and email verification
- **Institutional Domain Requirement**: Registration strictly requires the `@psgtech.ac.in` domain (`src/backend/auth/auth-validation.ts`).
- **Student ID Format**: Validated against PSG Tech standard convention (2-digit admission year + 2-letter branch code + 3-digit roll number, e.g. `24CS001`).
- **Single-Use Verification Token**:
  - A cryptographically random 32-byte hex token is generated.
  - The SHA-256 hash of the token is stored in the `VerificationToken` table with a 15-minute expiration timestamp.
  - Verification emails are dispatched through the configured SMTP transport.
  - Upon clicking the link, the token is verified, marked `usedAt = now()`, and the user's `emailVerified` flag is set to `true`. Expired or reused tokens are strictly rejected.

### 3.2 Ballot privacy and participation records
The schema separates one-vote participation enforcement from the encrypted ballot payload, but this is not a claim of unconditional anonymity:
1. **`ElectionVoterParticipation`**:
   - Schema: `(id, electionId, voterId, votedAt, createdAt)`
   - Unique constraint: `@@unique([electionId, voterId])`
   - Purpose: Records participation and enforces one accepted vote per voter/election.
2. **`ElectionVote`**:
   - Stores the encrypted ballot and related receipt/transaction metadata.
   - The Prisma schema has optional `voterId` and `candidateId` relations. Implementations and historical records may differ in whether these are populated. Do not claim the database schema itself guarantees that vote records cannot be linked to a voter.
   - The intended privacy property is that candidate choice is carried in encrypted ballot data rather than exposed as a plain-text selection in normal voting flow.

### 3.3 Zero-Knowledge Proofs (BabyJubjub CDS Schnorr NIZKP)
To prevent ballot manipulation without compromising voter secrecy, VoteChain uses a Cramer-Damgård-Schoenmakers (CDS) 1-of-$N$ Disjunctive Non-Interactive Zero-Knowledge Proof on the twisted Edwards **BabyJubjub curve** with the **Poseidon hash function** (`src/security/zk-proof.ts`):
- For valid candidate public keys $P_1, P_2, \dots, P_m$:
  - For the voter's chosen candidate $k$, a real Schnorr announcement is computed: $A_k = r \cdot G$.
  - For each non-selected candidate $i \neq k$, simulated announcements and responses are generated: $A_i = s_i \cdot G + c_i \cdot P_i$.
  - The Fiat-Shamir challenge is computed: $ch = \text{Poseidon}(P_1, \dots, P_m, A_1, \dots, A_m)$.
  - The real challenge is derived: $c_k = ch - \sum_{i \neq k} c_i \pmod q$.
  - The response is computed: $s_k = r + c_k \cdot x \pmod q$.
- **Verification**: The verifier checks the challenge relation $\sum c_i = ch \pmod q$ and the response equations for each candidate. The proof is intended to establish a valid candidate selection without disclosing which candidate was chosen; the application has not been independently certified or formally audited.

### 3.4 Per-Election DEK & 2-of-3 Shamir Threshold Key Custody
- **Per-Election Key**: Modern elections use an election-specific Data Encryption Key (DEK). A SHA-256 key commitment is stored in the election's database record (`Election.keyCommitment`); it is not the on-chain vote commitment.
- **Shamir's Secret Sharing over $\text{GF}(256)$**:
  - The 32-byte DEK is split into 3 shares using high-entropy polynomials over Galois Field $\text{GF}(2^8)$ with irreducible polynomial $P(x) = x^8 + x^4 + x^3 + x + 1$ (`0x11b`).
  - Shares are serialized as `keyshare:<electionId>:<x>:<y_base64url>`.
  - Exactly one share is assigned to each of 3 designated trustee authorities.
- **Mandatory Threshold Reconstruction**:
  - Decryption is completely locked while the election is active.
  - When the election closes, authorities submit their key shares.
  - Reconstructing the DEK requires at least 2 distinct valid authority shares via Lagrange interpolation over $\text{GF}(256)$:
    $$S = \sum_{j=1}^{k} y_j \prod_{m \neq j} \frac{x_m}{x_m \oplus x_j}$$
  - The reconstructed key must match the SHA-256 `keyCommitment` stored for that election.
  - 0 shares, 1 share, duplicate shares (A+A), tampered shares, and wrong-election shares are strictly rejected.

### 3.5 Real Persistent Offline Voting (Phase 13 Engine)
VoteChain includes a durable client-side offline voting engine (`src/offline/indexeddb.ts`, `src/offline/offline-encryption.ts`, `src/offline/sync.ts`):
1. **Network Disruption Detection**: Real `navigator.onLine` checks and `online`/`offline` window events.
2. **Local Device Encryption**: When offline, the ballot is encrypted locally via the browser's native **WebCrypto AES-256-GCM** API. The ephemeral encryption key is sealed in a local envelope using PBKDF2 with SHA-256 derived from the device salt and election ID (`localKeyEnvelope`).
3. **Local Persistence**: The encrypted vote is stored in browser **IndexedDB** (`VoteChainOfflineDB`, object store `pending_votes`) and can survive reloads or restarts while browser storage remains available. Browser storage may be cleared or evicted.
4. The queue is intended to keep ballot contents encrypted in local storage; it is not protection against a compromised browser/device.
5. **Auto-Synchronization**: When connectivity returns, the synchronizer submits the pending ballot to the backend. Only a server-accepted submission can become a confirmed vote and receive its receipt.
6. **Replay Protection**: Server and database checks reject a second accepted vote in the same election.

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
- The application builds SHA-256 Merkle integrity data from accepted vote/receipt records (`src/verification/merkle.ts`).
- The Merkle root is calculated and published.
- The `/verify` page accepts receipt verification information and checks inclusion against the applicable Merkle root:
  - The verifier hashes the voter's receipt along the sibling hash path:
    $$H_{\text{parent}} = \text{SHA-256}(H_{\text{left}} : H_{\text{right}})$$
  - A valid inclusion check is evidence that the corresponding record is represented by the checked root; it does not by itself certify the election process or its input data.

### 3.8 Administrator, authority, and observer workflows
Administrative APIs use server-side role checks:

1. **Admin account**:
   - Administrators sign in to the console at `/`.
   - The local utility `scripts/create-or-reset-admin.ts` prompts for the password without echoing it. Passwords must not be supplied as command-line arguments:
     ```bash
     npx tsx --env-file=.env scripts/create-or-reset-admin.ts [email]
     ```

2. **Authority invitations and activation**:
   - An administrator invites authority accounts through the dashboard. The invitation email contains a time-limited, single-use activation link.
   - The invitee follows the link to set up/activate the authority account and then signs in to `/authority`.
   - Administrators assign trustees to each election. The election's configured threshold requires distinct authority approvals/shares after closure before a modern-election tally is authorized.
   - Authority accounts are a separate role and cannot vote as ordinary eligible voters.

3. **Election preparation and publication**:
   - Create the election, enter its schedule in IST, add candidates, import the eligible-voter CSV, assign trustees, and configure observer access. Datetime-local input is converted to UTC for storage.
   - Use administrator lifecycle controls to activate the election, close it, and publish results only after required authority authorization.
   - Early closure is available to administrators. Elections with recorded participation/votes are protected from deletion to preserve audit history.

4. **Observer access and monitoring**:
   - An election-scoped access code opens `/observe` for monitoring via a scoped observer token.
   - An authenticated account with the `OBSERVER` role uses `/observer` for the observer dashboard.
   - Observer surfaces provide election/turnout and integrity information; official candidate totals are only shown after results publication.

5. **Voter receipts and results**:
   - After a vote has been accepted, the voter can verify its receipt at `/verify` and download a PDF receipt from the voter portal.
   - PDF downloads are authenticated and restricted to the participating voter or an administrator.
   - `/results` lists closed and published elections. Candidate totals are official only for an election in the `RESULTS_PUBLISHED` state; a `CLOSED` state alone does not publish a tally. A tie at the highest vote count produces no unique winner; zero votes is reported separately.

---

## 4. Implementation map

| Component | Current implementation |
| :--- | :--- |
| Registration and authentication | Institutional email checks, Nodemailer delivery, bcryptjs hashes, HMAC session cookies, and role checks. |
| Eligibility and one vote | Election-specific CSV roster import and server/database checks against repeat voting. |
| Ballot confidentiality | AES-GCM ballot encryption and a candidate-validity proof. The database schema's optional voter relation means this prototype does not promise unconditional anonymity. |
| Threshold tally authorization | Election-specific key commitment and distinct trustee approval/share threshold, normally 2 of 3. |
| Blockchain | Ethereum Sepolia commitment through the `VoteChainLedger` contract; separate from the database-stored election key commitment. |
| Receipts and integrity | Transaction receipt details, PDF download, Merkle verification, audit records, and an internal hash-linked block ledger. |
| Offline flow | Encrypted IndexedDB queue with retry when connectivity returns; the ballot remains pending until backend acceptance. |
| Observer monitoring | Scoped access-code view at `/observe` and signed-in role dashboard at `/observer`. |
| Results | Official candidate totals become visible after results are authorized and the election is `RESULTS_PUBLISHED`. |
| Tie handling | A top-count tie is `NO_RESULT_TIED`; zero counted votes is `NO_RESULT_NO_VOTES`. |
| Timezone handling | Election schedule inputs and displayed election/audit times use IST; stored dates are UTC instants (`src/shared/timezone.ts`). |

---

## 5. Technology, configuration, and limits

The stack is Next.js 16 App Router, React 19, Tailwind CSS 4, TypeScript, Prisma 6, PostgreSQL (Neon-hosted in the deployed environment), Nodemailer, ethers.js 6, Solidity, Ganache for local EVM development, `circomlibjs`, `snarkjs`, browser WebCrypto, and IndexedDB. Shared IST formatting and datetime conversion are implemented in `src/shared/timezone.ts`. The app is hosted on Vercel; Sepolia is a test network.

Local configuration uses environment variable names such as `DATABASE_URL`, `SESSION_SECRET`, `BALLOT_ENCRYPTION_KEY`, optional `KEY_ENCRYPTION_KEY`, `NEXT_PUBLIC_APP_URL`, `EMAIL_USER`, `EMAIL_APP_PASSWORD`, `ADMIN_EMAIL_USER`, `ADMIN_EMAIL_APP_PASSWORD`, `ETHEREUM_RPC_URL`, `VOTECHAIN_CONTRACT_ADDRESS`, and optional relayer values `ETHEREUM_PRIVATE_KEY` / `ETHEREUM_ACCOUNT`. Vercel provides its deployment URL variables. Keep actual values in local ignored `.env` files or the hosting provider's encrypted settings.

See [`README.md`](../README.md) for prerequisites, migration and local run commands, deployment guidance, and the teacher-facing Key Files guide. Prisma schema changes should use committed migrations deployed with `npm run db:migrate`; this document update does not require a migration.

**Limitations:** Email ownership is not identity proof; a compromised browser can expose a selected candidate before encryption; operators and database access remain in the threat model; offline ballots can remain unsynchronized; blockchain/Merkle evidence does not prove the roster or software was correct; and the system has no election certification or coercion resistance. It is an educational prototype, not a government-election system.
