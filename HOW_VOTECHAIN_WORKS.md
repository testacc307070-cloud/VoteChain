# How VoteChain Works: Complete Conceptual & Working Guide

This guide explains how the **VoteChain** electronic voting system operates under the hood, based on the **actual verified local implementation**.

---

## 1. The Big Picture: Why It Runs Locally

VoteChain is an **online voting prototype running on a local consortium network**.

When running on your machine:
- **It is not "offline-only" code**: Every vote makes real network requests across TCP ports:
  - Port `3000`: Next.js web application and API gateway
  - Port `5433`: PostgreSQL 18 relational database
  - Port `8545`: Ganache Ethereum Virtual Machine (EVM) blockchain node
- **Why Ganache instead of public Ethereum?** Public Ethereum costs \$5–\$50 per transaction in gas fees and exposes network traffic to public internet miners. Real elections are deployed on **Private Consortium Blockchains** (such as Quorum or private EVM nodes). Your local Ganache node executes compiled Solidity bytecode in [`VoteChainLedger.sol`](contracts/VoteChainLedger.sol), consumes gas, and mines blocks identically to a live public blockchain.

---

## 2. Step-by-Step System Concept: From Login to Final Results

### Step 1: How the Voter Logs In
1. The voter visits `http://localhost:3000/login` and enters their email and password.
2. The server compares the submitted password against the `passwordHash` stored in the PostgreSQL `User` table using **Bcrypt** (salt rounds = 12).
3. If verified, the server generates an HMAC-SHA256 signed session token stored in an **HTTP-only, SameSite=Lax cookie**.
4. The system checks the user's role:
   - `ADMIN` is redirected to `/` (Admin Dashboard)
   - `VOTER` is redirected to `/portal` (Voter Portal)
   - `AUTHORITY` is redirected to `/authority` (Key Custody Dashboard)
   - `OBSERVER` is redirected to `/observer` (Public Audit Dashboard)
5. Any attempt by an unauthorized role to access protected routes is intercepted and blocked by role guards in [`src/lib/role-routing.ts`](src/lib/role-routing.ts) and [`src/proxy.ts`](src/proxy.ts).

---

### Step 2: How Eligibility Works (One-Person-One-Vote)
1. When a voter selects an election, VoteChain executes an eligibility check in [`src/lib/eligibility.ts`](src/lib/eligibility.ts):
   - Is the voter account `ACTIVE` (not suspended)?
   - If the election specifies an `eligibleVoterIds` whitelist, is the voter's student ID on the list?
   - Has the voter already voted in this election?
2. To check if the voter has already voted, VoteChain queries the **`ElectionVoterParticipation`** table.
3. If a record exists matching `(electionId, voterId)`, the system immediately blocks submission with a `409 Conflict: Already voted` error.

---

### Step 3: How the Vote Is Encrypted (AES-256-GCM)
1. When the voter clicks a candidate, the system generates a cryptographically secure 12-byte random nonce.
2. The candidate selection is encrypted using **AES-256-GCM** in [`src/lib/encrypted-ballot.ts`](src/lib/encrypted-ballot.ts):
   - **Ciphertext**: The encrypted candidate string.
   - **Authentication Tag**: A 16-byte GCM tag ensuring ciphertext cannot be modified without detection.
   - **Additional Authenticated Data (AAD)**: The `electionId` is bound into the cipher so the ballot cannot be replayed in a different election.

---

### Step 4: How Zero-Knowledge (ZK) Validation Works
- **The Problem**: If the server checks your candidate choice before encrypting, the server learns who you voted for (breaking privacy). If the server doesn't check it, someone could submit an invalid candidate ID (breaking integrity).
- **The Solution**: Cramer-Damgård-Schoenmakers (CDS) 1-out-of-$N$ Disjunctive Non-Interactive Zero-Knowledge Proof (NIZKP) on the **BabyJubjub elliptic curve** with the **Poseidon cryptographic hash function** ([`src/lib/zk-proof.ts`](src/lib/zk-proof.ts)):
  1. The voter's browser computes a mathematical proof that the ballot commits to one of the valid candidates in $\{C_1, C_2, \dots, C_m\}$.
  2. For the chosen candidate, a real Schnorr announcement is computed.
  3. For all other non-selected candidates, random challenges and responses are simulated.
  4. The Fiat-Shamir heuristic computes $ch = \text{Poseidon}(\text{commitments})$.
  5. The verifier checks the proof without ever discovering which branch was the actual choice.

---

### Step 5: How Identity Is Separated from the Ballot (Double-Blind Privacy)
The database separates voter participation records from anonymous encrypted ballot records; the ballot record does not contain voter ID.

1. **`ElectionVoterParticipation` Table**:
   - Stores: `(electionId, voterId, createdAt)`
   - Purpose: Records *that* a voter participated, preventing double voting.
2. **`ElectionVote` Table**:
   - Stores: `(electionId, encryptedBallot, ballotNonce, ballotAuthTag, ballotProof, zkProof, receiptHash, txHash, blockNumber)`
   - Purpose: Stores the anonymous encrypted ballot and its ZK proof.
   - The ballot record does not contain voter ID or foreign keys linking back to the user.

---

### Step 6: How the Blockchain Records the Vote
1. The server computes a cryptographic commitment:
   $$\text{commitment} = \text{Keccak256}(\text{ciphertext} : \text{zkProof})$$
2. The server signs an Ethereum transaction calling `recordVote(electionId, commitment)` on [`contracts/VoteChainLedger.sol`](contracts/VoteChainLedger.sol).
3. The Ethereum smart contract executes on Ganache:
   - It checks `require(!commitmentUsed[commitment])`. If the same commitment is submitted twice, the EVM transaction reverts.
   - It marks `commitmentUsed[commitment] = true` and increments `voteCount`.
   - It emits the `VoteRecorded` event.
4. The transaction is mined into a real block with gas consumption, a transaction hash, and a block number.

---

### Step 7: How the Receipt Works
1. Upon mining, the server constructs a cryptographic receipt containing:
   - **Transaction Hash** (e.g. `0xfc254872efa0559c...`)
   - **Block Number** (e.g. Block `#59`)
   - **Ballot Commitment Hash**
   - **Receipt ID**
2. The voter can download or copy this receipt hash. It proves their vote is permanently registered on the blockchain without revealing who they voted for.

---

### Step 8: How Authorities Participate (Threshold Cryptography)
1. In VoteChain, **no single administrator can decrypt ballots while an election is open**.
2. When the election is created, the master encryption key is split into $n$ mathematical shares using **Shamir's Secret Sharing over Galois Field $\text{GF}(256)$** ([`src/lib/authority.ts`](src/lib/authority.ts)).
3. Each authority receives one secret share.
4. When the election closes, authorities log in to `/authority` and click **"Approve & Submit Key Share"**.
5. Until the threshold quorum ($k$-of-$n$, e.g. 2-of-3) is reached, tallies remain completely locked.

---

### Step 9: How Votes Are Counted
1. Once the required number of authorities have submitted their shares, the system executes **Lagrange polynomial interpolation over $\text{GF}(2^8)$**:
   $$S = \sum_{j=1}^{k} y_j \prod_{m \neq j} \frac{x_m}{x_m \oplus x_j}$$
2. The original master key is reconstructed in memory.
3. The system decrypts all ballots in `ElectionVote` and counts candidate totals.
4. The database separates voter participation records from anonymous encrypted ballot records; the ballot record does not contain voter ID.

---

### Step 10: How Merkle Verification Works
1. All cast ballot commitments are arranged as the leaves of a balanced SHA-256 Merkle Tree ([`src/lib/integrity.ts`](src/lib/integrity.ts)).
2. The system calculates the Merkle Root and commits it to the blockchain via `finalizeElection()` in [`VoteChainLedger.sol`](contracts/VoteChainLedger.sol).
3. Any voter can visit `/verify`, enter their receipt hash, and receive a **cryptographic Merkle inclusion proof** (sibling hash path).
4. The voter's device hashes their receipt along the sibling path. If it matches the on-chain Merkle Root, it mathematically proves their vote was tallied in the final result.

---

### Step 11: How Public Verification Works
- Any citizen, student, or journalist can open `/verify` or `/results` **without logging in**.
- The page displays:
  - Total votes cast
  - Smart contract address and mined block count
  - Candidate vote tallies (only after publication)
  - Scannable **Election Verification QR Code** encoding the election proof URL

---

### Step 12: How Tamper Detection Works
1. Every block in the application ledger contains:
   $$\text{hash} = \text{SHA256}(\text{index} : \text{timestamp} : \text{previousHash} : \text{payload})$$
2. In the Observer Dashboard (`/observer`), an interactive **Tamper Detection Simulation** allows an auditor to simulate a malicious database modification.
3. The system continuously validates the chain: if any payload or previous hash is altered, the cryptographic link breaks ($H_i \neq \text{SHA256}(\dots)$).
4. The dashboard immediately displays a **CRITICAL / TAMPER DETECTED** alert, identifying the exact tampered block.

---

### Step 13: How Offline / Network-Failure Simulation Works
1. On the Voter Portal, an **"Offline / Network Disruption Simulation"** toggle is provided (implementing Section 4.8 of the spec).
2. When toggled **ON**, submitting a vote stores the encrypted ballot and ZK proof in the browser's local fault buffer (`IndexedDB` / `localStorage`).
3. When the network is restored (toggled **OFF**), the voter clicks **"Sync Queued Votes"**.
4. The client automatically submits the buffered transaction to the server, mines the Ethereum block on Ganache, and renders the confirmed receipt.

---

## 3. Implementation Status: Full vs. Simulated Components

To ensure complete transparency, here is the exact breakdown of implemented vs. demonstration features:

| Component | Status | Details |
|---|---|---|
| **PostgreSQL Database** | **Fully Implemented** | PostgreSQL 18 with 6 Prisma relational tables and migration pipeline. |
| **Authentication & Roles** | **Fully Implemented** | Bcrypt hashing, HMAC-SHA256 session cookies, 4 role permission gates. |
| **Ethereum Smart Contract** | **Fully Implemented** | Compiled Solidity `VoteChainLedger.sol` running on local Ganache EVM. |
| **Double-Blind Secrecy** | **Fully Implemented** | The database separates voter participation records from anonymous encrypted ballot records; the ballot record does not contain voter ID. |
| **AES-256-GCM Encryption** | **Fully Implemented** | Authenticated symmetric cipher with random nonces and AAD binding. |
| **Zero-Knowledge Proofs** | **Fully Implemented** | BabyJubjub/Poseidon CDS 1-of-N disjunctive Schnorr NIZKP (`circomlibjs`). |
| **Threshold Key Custody** | **Fully Implemented** | Shamir's Secret Sharing over Galois Field $\text{GF}(256)$ ($0x11b$ polynomial). |
| **Merkle Inclusion Proofs** | **Fully Implemented** | Balanced SHA-256 Merkle tree and sibling path verifier. |
| **Offline Fault Tolerance** | **Demonstration Mode** | Client-side fault buffer and sync replay simulation (Section 4.8). |
| **Ledger Tamper Detection** | **Demonstration Mode** | Interactive controlled tampering to prove chain verification alerts. |
| **Blockchain Network Scope**| **Local Consortium** | Runs locally on Ganache (port 8545). Internet deployment is a future phase. |
