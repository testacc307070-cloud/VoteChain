# How VoteChain Works: Complete Conceptual & Technical Guide

This document provides a comprehensive, end-to-end explanation of how the **VoteChain** electronic voting system operates, based on the **actual, audited production implementation** in the repository.

---

## 1. High-Level Architecture

VoteChain is an end-to-end verifiable electronic voting system designed for institutional elections (specifically PSG College of Technology's `@psgtech.ac.in` domain). The system runs across four main tiers:

```
[ Voter / Admin / Authority / Observer Browser ]
         │
         │ HTTPS (Vercel Serverless Platform)
         ▼
[ Next.js 16 App Router & API Gateway ]
   ├── Middleware: CSRF Guards, Role Routing, CSP / HSTS Headers
   ├── Cryptographic Engines: AES-256-GCM, BabyJubjub CDS ZKP, Shamir GF(256)
   │
   ├── Database Tier: Neon Serverless PostgreSQL (Singapore ap-southeast-1)
   │     ├── Users, Passwords (Bcrypt 12 rounds), VerificationTokens
   │     ├── Elections, Candidates, Eligibility Whitelists
   │     ├── Decoupled Voter Participations (1 participation per voter)
   │     ├── Anonymous Encrypted Ballots (candidateId = null)
   │     └── Micro-Blockchain Blocks & Audit Trail
   │
   ├── Blockchain Tier: Ethereum Sepolia Public Testnet (Chain ID 11155111)
   │     ├── Smart Contract: VoteChainLedger.sol (0x7339F8B088A2835F26e158c9F96690395D80264D)
   │     └── Immutable Commitment Registry: commitmentUsed(keccak256(ciphertext:proof))
   │
   └── Client-Side Offline Engine: Browser IndexedDB (VoteChainOfflineDB)
         ├── WebCrypto AES-256-GCM encryption with PBKDF2 localKeyEnvelope
         └── Automatic Network Synchronization on 'online' Event
```

---

## 2. Step-by-Step Technical Lifecycle

### Step 1: Voter Registration & Institutional Email Verification
1. A student registers at `/register` by providing their Full Name, Student ID (e.g. `24CS001`), official PSG Tech email (`student@psgtech.ac.in`), and a strong password.
2. The server validates institutional credentials in [`src/lib/auth-validation.ts`](src/lib/auth-validation.ts):
   - Email domain must strictly match `@psgtech.ac.in`.
   - Student ID must match the format `^[0-9]{2}[A-Za-z0-9]{4,10}$`.
   - Password must contain at least 8 characters, with uppercase, lowercase, numbers, and special characters.
3. The password is hashed using **Bcrypt with 12 salt rounds**.
4. A cryptographically random 32-byte raw token is generated (`rawToken`). Its SHA-256 hash (`tokenHash`) is saved in the `VerificationToken` table with a 24-hour expiration timestamp.
5. An email is dispatched via **Nodemailer using Gmail SMTP TLS transport** (`votechain.verify@gmail.com`) in [`src/lib/email.ts`](src/lib/email.ts).
6. When the student clicks the verification link (`/verify-email?token=...`), the server marks `usedAt = new Date()` in an atomic transaction and updates the user's status to `emailVerified = true`. Any reused token is rejected.

---

### Step 2: Multi-Factor Voter Eligibility (Class Whitelists)
1. The election administrator uploads an official class eligibility CSV register (e.g. Computer Science Class A) in [`src/lib/csv-eligibility.ts`](src/lib/csv-eligibility.ts).
2. The CSV parser validates header formats, removes duplicates, checks institutional email domains, and populates the `ElectionEligibleVoter` table for that specific `electionId`.
3. When a voter enters the voting portal (`/portal`), the server executes [`checkVoterElectionEligibility`](src/lib/eligibility.ts):
   - **Account Verification**: Is the account status `ACTIVE` and `emailVerified == true`?
   - **Whitelist Inclusion**: Is the voter's Student ID and email in `ElectionEligibleVoter` for this election?
   - **Active Window**: Is the current server time between `election.startTime` and `election.endTime`?
   - **Participation History**: Has the voter already participated in this election?

---

### Step 3: Candidate Selection & Client-Side Encryption (AES-256-GCM)
1. When the voter selects a candidate, the system generates a cryptographically secure 12-byte random nonce (`voteId`).
2. The candidate selection is encrypted using **AES-256-GCM** in [`src/lib/encrypted-ballot.ts`](src/lib/encrypted-ballot.ts):
   - **Ciphertext**: The AES-GCM encrypted candidate identifier string.
   - **Authentication Tag**: A 16-byte GCM authentication tag ensuring ciphertext integrity.
   - **Authenticated Additional Data (AAD)**: The `electionId` is bound as AAD so a ballot cannot be intercepted and replayed in a different election.

---

### Step 4: Zero-Knowledge Proof of Valid Ballot Choice
To prevent voters from submitting invalid candidate IDs or corrupt data while preserving complete ballot privacy:
- VoteChain implements a Cramer-Damgård-Schoenmakers (CDS) 1-out-of-$N$ Disjunctive Non-Interactive Zero-Knowledge Proof (NIZKP) on the **BabyJubjub twisted Edwards elliptic curve** with the **Poseidon algebraic hash function** ([`src/lib/zk-proof.ts`](src/lib/zk-proof.ts)):
  1. The prover represents the election's allowed candidate set as $\{C_1, C_2, \dots, C_m\}$.
  2. For the voter's chosen candidate $C_w$, a real Schnorr commitment and announcement are generated using secret randomness.
  3. For all $m - 1$ unselected candidate branches, simulated challenges and responses are computed so they satisfy the verification equations without revealing which branch was real.
  4. The Fiat-Shamir heuristic binds all candidate commitments into an overall challenge:
     $$ch = \text{Poseidon}(R_1, R_2, \dots, R_m)$$
  5. The verifier validates the sum of challenges $\sum c_i = ch$ and verifies the Schnorr relation for every branch.
  6. **Privacy Guarantee**: The verifier confirms mathematically that the ballot commits to exactly one allowed candidate without learning which candidate was selected.

---

### Step 5: Double-Blind Database Separation (Voter Secrecy)
VoteChain decouples voter identity from ballot choices through physical table separation in [`prisma/schema.prisma`](prisma/schema.prisma):

1. **`ElectionVoterParticipation` Table**:
   - Stores: `(id, electionId, voterId, votedAt, createdAt)`
   - Purpose: Records *that* a student voted, enforcing the one-person-one-vote rule.
   - Contains **zero reference** to vote ID, candidate ID, ciphertext, receipt, or transaction hash.
2. **`ElectionVote` Table**:
   - Stores: `(id, electionId, voterId, candidateId, encryptedBallot, ballotNonce, ballotAuthTag, ballotProof, zkProof, blockNumber, submittedAt)`
   - **Anonymization**: In the production voting flow, `candidateId` is strictly set to **`null`**.
   - Contains only the ciphertext and cryptographic proofs.
   - It is mathematically impossible to link a voter ID to their candidate selection from the database logs.

---

### Step 6: Real Persistent Offline Voting & Auto-Sync (Phase 13)
When a voter experiences internet disruption while voting:
1. **Durable Browser Storage**: The vote is saved to **IndexedDB** (`VoteChainOfflineDB`, object store `pending_votes`) in [`src/lib/offline-storage.ts`](src/lib/offline-storage.ts). Unlike `localStorage` or memory, this survives browser crashes, tab closure, and power loss.
2. **Client-Side AES-256-GCM Envelope**: The ballot choice is encrypted client-side using WebCrypto (`crypto.subtle`). An ephemeral key is generated, and sealed into a local envelope (`localKeyEnvelope`) derived via PBKDF2 from a device salt and `electionId` in [`src/lib/offline-encryption.ts`](src/lib/offline-encryption.ts).
3. **Zero Plaintext Leakage**: Zero candidate names or IDs are stored in plaintext on disk; zero server secrets (`BALLOT_ENCRYPTION_KEY`, DEKs, private keys) exist in client storage.
4. **UI State Machine**: The UI strictly displays `"Vote securely stored locally — waiting for internet"` (never `"Vote confirmed"` while in local queue).
5. **Automatic Synchronization**: [`src/lib/offline-sync.ts`](src/lib/offline-sync.ts) listens for the browser `online` event. When network connectivity returns:
   - The pending ballot is unsealed in memory.
   - The ZK proof is verified.
   - The ballot is submitted to the backend and mined to Ethereum Sepolia.
   - The confirmed receipt is stored and the queue item is marked `CONFIRMED`.

---

### Step 7: Public Blockchain Recording (Ethereum Sepolia)
1. The server computes a cryptographic commitment over the ciphertext and ZK proof:
   $$\text{commitment} = \text{Keccak256}(\text{ciphertext} : \text{zkProof})$$
2. The server relayer (`0xd9f43Cd01A317849e54DbcCB03380dA3EDE5E063`) submits an Ethereum transaction to [`VoteChainLedger.sol`](contracts/VoteChainLedger.sol) at address `0x7339F8B088A2835F26e158c9F96690395D80264D`:
   ```solidity
   function recordVote(bytes32 electionId, bytes32 commitment) external;
   ```
3. The smart contract validates replay protection on-chain:
   ```solidity
   require(!commitmentUsed[commitment], "Vote commitment already recorded");
   commitmentUsed[commitment] = true;
   emit VoteRecorded(electionId, commitment, msg.sender, block.timestamp);
   ```
4. The transaction confirms on Ethereum Sepolia, producing an immutable transaction hash and block number.

---

### Step 8: Deterministic Cryptographic Receipts
Upon mining, the voter is issued a cryptographic receipt ([`src/lib/voting.ts`](src/lib/voting.ts)):
- **Receipt ID**: e.g. `RCPT-FE30674FB018`
- **Record Hash**: $\text{recordHash} = \text{SHA-256}(\text{electionId} : \text{voteId} : \text{submittedAt})$
- **Sepolia Transaction Hash**: e.g. `0x3571994fb08cb269a5dea627643f39ac43d8da4b5a8d84dc0a4928c50819588a`
- **Block Number**: e.g. `#11821078`

The receipt proves that the voter's ballot is recorded on the blockchain without revealing who they voted for.

---

### Step 9: Per-Election Keys & Mandatory 2-of-3 Threshold Decryption
1. **Per-Election DEK Architecture (Phase 9.1)**: Each election generates a distinct 256-bit AES key. The key is committed on election creation via SHA-256 (`keyCommitment`) and stored encrypted (`encryptedMasterKey`) in [`src/lib/election-keys.ts`](src/lib/election-keys.ts).
2. **2-of-3 Shamir Secret Sharing (Phase 9.2)**: In [`src/lib/authority.ts`](src/lib/authority.ts), the master DEK is split into 3 shares over Galois Field $\text{GF}(256)$ using the AES irreducible polynomial $P(x) = x^8 + x^4 + x^3 + x + 1$ ($0x11b$).
3. **Share Custody**: Each of the 3 designated Authority Trustees receives exactly 1 share bound to the election ID (`keyshare:electionId:x:shareBytes`).
4. **Mandatory Threshold Quorum (Phase 9.3)**:
   - When the election closes, authorities log in to `/authority` and approve the election tally.
   - The tally route strictly requires approvals from $\ge 2$ distinct authorities.
   - 0 shares, 1 share, duplicate approvals from the same authority (A+A), tampered shares, and foreign election shares are strictly rejected.
   - Once 2 valid shares are received, Lagrange interpolation over $\text{GF}(256)$ reconstructs the secret DEK:
     $$S = \sum_{j=1}^{k} y_j \prod_{m \neq j} \frac{x_m}{x_m \oplus x_j}$$
   - The reconstructed key is validated against the election's `keyCommitment`.
   - All encrypted ballots in `ElectionVote` are decrypted in memory, candidate totals are counted, and the certified result is published.

---

### Step 10: Merkle Tree Universal & Individual Verifiability
1. When results are published, all cast ballot commitments are arranged as the leaves of a balanced SHA-256 Merkle tree in [`src/lib/integrity.ts`](src/lib/integrity.ts).
2. The Merkle root is calculated and committed:
   $$\text{Root} = \text{SHA256}(\text{Hash}_{\text{left}} : \text{Hash}_{\text{right}})$$
3. **Individual Verifiability**: Any student can navigate to `/verify` without logging in, enter their receipt, and receive their Merkle inclusion proof (sibling hash path).
4. **Universal Verifiability**: Anyone can verify that the published candidate tallies equal the total leaves of the Merkle tree.

---

### Step 11: Application Micro-Blockchain & Tamper Detection
1. In addition to Ethereum Sepolia, VoteChain maintains an internal micro-blockchain ledger per election in `ElectionBlockchainBlock` ([`src/lib/blockchain.ts`](src/lib/blockchain.ts)).
2. Each block commits the SHA-256 hash of the preceding block:
   $$\text{blockHash} = \text{SHA-256}(\text{index} : \text{timestamp} : \text{previousHash} : \text{payload})$$
3. In the Public Observer Dashboard (`/observer`), an interactive **Tamper Detection Simulation** allows observers to simulate malicious database tampering.
4. The system validates the chain head: if any payload or hash is modified, the cryptographic chain breaks, and a **CRITICAL / TAMPER DETECTED** alert is immediately displayed.

---

## 3. Implementation Status Summary

| Architectural Component | Status | Technical Details |
| :--- | :---: | :--- |
| **Cloud PostgreSQL Database** | **Fully Implemented** | Neon Serverless PostgreSQL (`ap-southeast-1`) with 7 relational Prisma models and connection pooling resilience |
| **Authentication & RBAC** | **Fully Implemented** | Bcrypt (12 rounds), HMAC-SHA256 signed session cookies, 4 isolated role dashboards (`/portal`, `/admin`, `/authority`, `/observer`) |
| **Institutional Email Verification** | **Fully Implemented** | Nodemailer with Gmail SMTP (`votechain.verify@gmail.com`), PSG Tech domain checking, single-use 24h tokens |
| **Class Eligibility Whitelists** | **Fully Implemented** | Admin CSV import, deduplication, election-bound voter register whitelist |
| **One-Person-One-Vote** | **Fully Implemented** | Database unique constraint `@@unique([electionId, voterId])` on `ElectionVoterParticipation` |
| **Double-Blind Voter Privacy** | **Fully Implemented** | Complete decoupling between participation records and anonymous votes (`candidateId = null`) |
| **Per-Election DEK Architecture** | **Fully Implemented** | Unique 256-bit DEK generated per election, SHA-256 `keyCommitment`, envelope-sealed storage |
| **AES-256-GCM Ballot Encryption** | **Fully Implemented** | Authenticated symmetric cipher with random 12-byte IVs, 16-byte auth tags, and `electionId` AAD binding |
| **Zero-Knowledge Proofs** | **Fully Implemented** | BabyJubjub elliptic curve + Poseidon hash CDS 1-of-N disjunctive Schnorr NIZKP (`circomlibjs`) |
| **2-of-3 Threshold Key Custody** | **Fully Implemented** | Shamir's Secret Sharing over $\text{GF}(256)$ ($0x11b$ polynomial); mandatory $\ge 2$ authority approval for final tally |
| **Ethereum Sepolia Blockchain** | **Fully Implemented** | `VoteChainLedger.sol` deployed at `0x7339F8B088A2835F26e158c9F96690395D80264D`; duplicate commitment protection |
| **Real Persistent Offline Voting** | **Fully Implemented** | IndexedDB (`VoteChainOfflineDB`) persistent queue, client WebCrypto AES-GCM, PBKDF2 envelopes, automatic sync on reconnect |
| **Cryptographic Receipts** | **Fully Implemented** | Deterministic SHA-256 receipt generation, public receipt verification at `/verify` |
| **Merkle Tree Inclusion Proofs** | **Fully Implemented** | Balanced SHA-256 Merkle tree calculation, Merkle root commitment, individual inclusion proof verifier |
| **Micro-Blockchain Ledger** | **Fully Implemented** | Internal SHA-256 chained block ledger with full continuity verification and tamper detection simulation |
| **Security Headers & CSRF** | **Fully Implemented** | Nonce-based CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, strict referrer, origin/referer CSRF validation |

---

## 4. Security & Privacy Guarantees vs. Known Limitations

### What VoteChain Guarantees:
- **Ballot Secrecy**: No database administrator, observer, or single authority trustee can read individual ballot choices.
- **One-Person-One-Vote**: A voter can never cast more than one ballot in the same election.
- **Ballot Validity Without Choice Leakage**: ZK proofs prove that every ballot represents an authorized candidate without revealing which candidate.
- **Tamper Evidence**: Any modification to database records or micro-blockchain blocks is immediately detected by Merkle proofs and hash chain validation.
- **On-Chain Recording**: Every vote is committed to Ethereum Sepolia, providing immutable proof of recording.
- **Offline Durability**: Ballots cast while offline survive browser crashes and synchronize automatically when the network returns.

### What VoteChain Does Not Claim:
- **National Election Suitability**: VoteChain is an educational research prototype. It is not certified for governmental or legally binding civic elections.
- **Physical Biometric Identity**: Email verification proves control of an institutional `@psgtech.ac.in` email account; it does not independently verify physical human presence.
- **Coercion Resistance**: While the system prevents others from reading a ballot, receipts prove that a vote was cast. It does not provide receipt-free coercion resistance.
- **Decentralized Voter Gas**: Transactions are relayed by the server's sponsored signer (`0xd9f43Cd01A317849e54DbcCB03380dA3EDE5E063`) to eliminate MetaMask requirements for students.
