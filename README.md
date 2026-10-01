# VoteChain: Privacy-Preserving Blockchain Electronic Voting System

> **Educational & Research Prototype Notice**: VoteChain is an end-to-end verifiable, privacy-preserving electronic voting prototype designed for university classroom elections, academic research, and institutional demonstrations. It is **not** certified for, nor intended to be used in, public governmental or national statutory elections.

---

## 1. Project Overview

VoteChain addresses the fundamental dilemma of electronic voting: **how to prove that an election was conducted fairly and votes were counted accurately without ever compromising any voter's secret choice**.

VoteChain achieves end-to-end verifiability and voter privacy by uniting four cryptographic pillars:
1. **Zero-Knowledge Proofs (ZKP)**: Proves mathematical validity of candidate choice on the BabyJubjub elliptic curve with Poseidon hashing without revealing which candidate was selected.
2. **Double-Blind Database Architecture**: Physical separation of voter participation records from anonymous encrypted ballot records; ballot records never contain voter identities.
3. **Multi-Authority Threshold Cryptography**: Splits per-election Data Encryption Keys (DEKs) across independent trustees using Shamir's Secret Sharing over Galois Field $\text{GF}(256)$. Tallying is strictly locked until a 2-of-3 authority quorum submits valid shares matching the on-chain key commitment.
4. **Ethereum Smart Contract Ledger**: Every vote commitment is mined into a smart contract on the Ethereum Sepolia blockchain ([`VoteChainLedger.sol`](contracts/VoteChainLedger.sol)), providing immutable replay protection and decentralized timestamping.
5. **Universal & Individual Verifiability**: Balanced SHA-256 Merkle inclusion proofs allow any voter or public auditor to verify that a specific ballot is included in the certified on-chain tally without logging in.
6. **Real Persistent Offline Voting**: Client-side WebCrypto AES-256-GCM encryption with durable IndexedDB queueing, surviving browser restarts and automatically synchronizing to the blockchain upon network recovery.

---

## 2. Production Architecture

VoteChain is deployed across a modern serverless cloud infrastructure:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         CLIENT TIER (Web Browser)                        │
│   React 19 UI  •  BabyJubjub CDS ZK Prover  •  IndexedDB Offline Queue   │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ HTTPS / Signed Session Cookies
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     APPLICATION GATEWAY (Vercel Serverless)              │
│    Next.js 16 (Turbopack) • CSRF Guards • Security Headers • Auth Engine │
└───────────────────────┬──────────────────────────┬───────────────────────┘
                        │                          │
           SQL over TLS │ Pooler (Port 5432)       │ JSON-RPC (Sepolia)
                        ▼                          ▼
┌────────────────────────────────┐       ┌────────────────────────────────┐
│   DATABASE TIER (Neon Cloud)   │       │ BLOCKCHAIN TIER (Sepolia EVM)  │
│   Serverless PostgreSQL        │       │ Contract: 0x7339F8B088A...     │
│   • Users & VerificationTokens │       │ • recordVote(elecId, commit)   │
│   • ElectionVoterParticipation │       │ • finalizeElection(root, digest│
│   • Anonymous ElectionVote     │       │ • commitmentUsed[commit] map   │
│   • Micro-Blockchain Blocks    │       │ Relayer: 0xd9f43Cd01A3...      │
└────────────────────────────────┘       └────────────────────────────────┘
```

1. **Client Tier**: Next.js 16 and React 19 web application. Executes client-side BabyJubjub Zero-Knowledge proofs and IndexedDB local ballot queueing with WebCrypto AES-256-GCM.
2. **Application Server**: Hosted on Vercel. Enforces signed HTTP-only cookies, SameSite origin validation, CSRF protections, and strict role guards.
3. **Database Tier**: Hosted on Neon PostgreSQL Serverless with Prisma ORM. Separates voter participation from anonymous encrypted ballots.
4. **Blockchain Tier**: Ethereum Sepolia testnet executing compiled Solidity smart contract `VoteChainLedger.sol` at `0x7339F8B088A2835F26e158c9F96690395D80264D`.
5. **Email Delivery**: Automated institutional verification via Gmail SMTP (`votechain.verify@gmail.com`) enforcing single-use 15-minute verification tokens for `@psgtech.ac.in` students.

---

## 3. Technology Stack

- **Framework**: Next.js 16.3.6 (App Router, Turbopack)
- **UI & Frontend**: React 19, Tailwind CSS, Lucide Icons
- **Database**: PostgreSQL (Neon Serverless) via Prisma Client 6.12.0
- **Blockchain**: Solidity 0.8.37, Ethers.js 6.17.0, Ethereum Sepolia Testnet, Ganache (Local Dev)
- **Zero-Knowledge Proofs**: `circomlibjs` (BabyJubjub Twisted Edwards Curve, Poseidon Hash, CDS 1-of-$N$ Schnorr NIZKP)
- **Symmetric Cryptography**: AES-256-GCM with Authenticated Additional Data (AAD) & PBKDF2
- **Threshold Scheme**: Shamir's Secret Sharing over Galois Field $\text{GF}(256)$ with $0x11b$ irreducible polynomial
- **Hashing & Merkle Trees**: SHA-256, Keccak-256, HMAC-SHA256, Balanced Binary Merkle Trees
- **Offline Storage**: Browser IndexedDB (`VoteChainOfflineDB`) via WebCrypto Subtle API
- **Authentication**: Institutional Email Verification, Bcrypt (12 rounds), HMAC session tokens

---

## 4. Project Structure

VoteChain follows a modular, layer-separated architecture designed for pedagogical clarity, code maintainability, and security auditability:

```
VoteChain/
├── contracts/                        # Solidity smart contract & EVM artifacts
│   ├── VoteChainLedger.sol           # Core on-chain ballot box with replay protection
│   └── VoteChainLedger.json          # Compiled contract ABI & bytecode
│
├── docs/                             # Architecture specifications & phase audit reports
│   ├── HOW_VOTECHAIN_WORKS.md        # Deep-dive cryptographic & architectural guide
│   ├── PHASE_14_FINAL_CLASS_ELECTION_REPORT.md  # 100-voter classroom simulation report
│   ├── PHASE_15_FINAL_SYSTEM_AUDIT.md # Comprehensive 17-section security audit
│   ├── VoteChain_Complete_Online_Deployment_Plan.md # Online deployment blueprint
│   └── VOTECHAIN_PHASE_COMPLETION.md # Complete 15-phase verification matrix
│
├── prisma/                           # Database ORM & schema definitions
│   ├── schema.prisma                 # Double-blind PostgreSQL schema
│   ├── seed.ts                       # Test elections & roles database seeder
│   └── migrations/                   # Atomic SQL schema migrations
│
├── scripts/                          # Operational & cloud deployment utilities
│   ├── deploy-contract.ts            # Sepolia contract compilation & deployment
│   ├── setup-testnet-wallet.ts       # Testnet relayer wallet generation & balance checker
│   ├── check-db-credentials.ts       # Neon serverless connection verifier
│   └── inspect-db.ts                 # Database state inspection utility
│
├── src/
│   ├── app/                          # Next.js App Router (UI pages & API endpoints)
│   │   ├── (pages)                   # /login, /register, /portal, /results, /audit, etc.
│   │   └── api/                      # REST endpoints for auth, elections, voting
│   │
│   ├── frontend/                     # Frontend client layer
│   │   └── components/               # React UI components (portal, manager, tamper-demo)
│   │
│   ├── backend/                      # Server-side business logic
│   │   ├── auth/                     # Registration, sessions, email tokens, role routing
│   │   └── voting/                   # Eligibility checks, CSV rosters, election validation
│   │
│   ├── database/                     # Database client & connection pooling
│   │   └── prisma.ts                 # Singleton PrismaClient instance
│   │
│   ├── blockchain/                   # Ethereum / Sepolia blockchain integration
│   │   ├── ethereum.ts               # Sepolia RPC provider, relayer wallet, contract client
│   │   └── blockchain.ts             # Micro-blockchain block chaining & hash verification
│   │
│   ├── security/                     # Cryptography & security primitives
│   │   ├── encryption.ts             # AES-256-GCM ballot encryption & decryption
│   │   ├── zk-proof.ts               # BabyJubjub CDS 1-of-K zero-knowledge proofs
│   │   ├── threshold.ts              # Shamir 2-of-3 GF(256) secret sharing & custody
│   │   ├── election-keys.ts          # Per-election DEKs & cryptographic key commitments
│   │   └── csrf.ts                   # Origin verification & anti-CSRF protection
│   │
│   ├── offline/                      # Real offline voting & recovery engine
│   │   ├── indexeddb.ts              # Persistent IndexedDB encrypted ballot queue
│   │   ├── offline-encryption.ts     # Client WebCrypto AES-GCM local envelope sealer
│   │   └── sync.ts                   # Background offline-to-online synchronizer
│   │
│   └── verification/                 # Verification, receipts & audit
│       ├── receipts.ts               # Cryptographic receipt generation & verification
│       ├── merkle.ts                 # Balanced Merkle tree root & inclusion proofs
│       ├── results.ts                # Election results tallying & decryption
│       ├── audit.ts                  # Immutable audit log builder
│       └── qr.ts                     # Receipt verification QR code generator
│
└── tests/                            # Automated test suites
    ├── unit/                         # 21 unit & security test files (143 subtests)
    ├── contracts/                    # Smart contract automated test suite (6 tests)
    └── e2e/                          # Full E2E verification & classroom load tests
```

---

## 5. Key Files — Where to Look

For evaluators, instructors, and security auditors, this table maps each logical area to its final file path:

| Area | Final File Path | Primary Responsibility & Contents |
| :--- | :--- | :--- |
| **Frontend UI** | [`src/app/portal/page.tsx`](src/app/portal/page.tsx) | Voter portal page rendering active election ballots and eligibility state. |
| **Frontend UI** | [`src/frontend/components/voter-portal-client.tsx`](src/frontend/components/voter-portal-client.tsx) | Client component managing candidate selection, offline queueing, and auto-sync. |
| **Frontend UI** | [`src/app/results/page.tsx`](src/app/results/page.tsx) | Certified public election results page with vote distributions and Merkle root. |
| **Frontend UI** | [`src/app/verify/page.tsx`](src/app/verify/page.tsx) | Public receipt verifier allowing any citizen/voter to verify receipts without logging in. |
| **Frontend UI** | [`src/app/authority/page.tsx`](src/app/authority/page.tsx) | Trustee dashboard for Shamir share custody and 2-of-3 threshold approval. |
| **Frontend UI** | [`src/app/observer/page.tsx`](src/app/observer/page.tsx) | Observer audit dashboard with micro-blockchain inspector and tamper demo. |
| **Authentication** | [`src/backend/auth/registration.ts`](src/backend/auth/registration.ts) | Student registration, institutional domain validation, single-use token lifecycle. |
| **Authentication** | [`src/backend/auth/session.ts`](src/backend/auth/session.ts) | HMAC-SHA256 signed session cookies, cookie validation, expiration checking. |
| **Authentication** | [`src/backend/auth/role-routing.ts`](src/backend/auth/role-routing.ts) | Role boundary guards isolating `VOTER`, `ADMIN`, `AUTHORITY`, and `OBSERVER`. |
| **Voting API** | [`src/app/api/voter/elections/[electionId]/vote/route.ts`](src/app/api/voter/elections/[electionId]/vote/route.ts) | Core voting API handling ZK validation, encryption, Sepolia relay, and micro-blockchain append. |
| **Voting Logic** | [`src/backend/voting/voting.ts`](src/backend/voting/voting.ts) | Vote submission validator, receipt generator, deterministic receipt hash verifier. |
| **Eligibility** | [`src/backend/voting/eligibility.ts`](src/backend/voting/eligibility.ts) | Per-election class roster whitelist verifier and voter eligibility checking. |
| **Database** | [`src/database/prisma.ts`](src/database/prisma.ts) | Singleton Prisma client with connection pooling for PostgreSQL. |
| **Database Schema** | [`prisma/schema.prisma`](prisma/schema.prisma) | Relational schema definitions separating `ElectionVote` from `ElectionVoterParticipation`. |
| **Ballot Encryption**| [`src/security/encryption.ts`](src/security/encryption.ts) | AES-256-GCM ballot encryption with random IV, authTag, and election AAD binding. |
| **Election Keys** | [`src/security/election-keys.ts`](src/security/election-keys.ts) | Per-election Data Encryption Key (DEK) generator, master envelope, key commitments. |
| **Zero-Knowledge** | [`src/security/zk-proof.ts`](src/security/zk-proof.ts) | BabyJubjub CDS 1-of-$N$ Schnorr proof generator and server-side verifier via Poseidon. |
| **Threshold Custody**| [`src/security/threshold.ts`](src/security/threshold.ts) | 2-of-3 Shamir Secret Sharing over $\text{GF}(256)$, share validation, Lagrange interpolation. |
| **Offline Storage**| [`src/offline/indexeddb.ts`](src/offline/indexeddb.ts) | Browser IndexedDB queue (`VoteChainOfflineDB`), persistent pending vote management. |
| **Offline Encryption**| [`src/offline/offline-encryption.ts`](src/offline/offline-encryption.ts) | WebCrypto AES-256-GCM device encryption, PBKDF2 local key envelope unsealing. |
| **Offline Sync** | [`src/offline/sync.ts`](src/offline/sync.ts) | Real network restoration listener, in-memory unsealing, server dispatch engine. |
| **Receipts** | [`src/verification/receipts.ts`](src/verification/receipts.ts) | Deterministic receipt hash computation and validation. |
| **Merkle Trees** | [`src/verification/merkle.ts`](src/verification/merkle.ts) | Balanced SHA-256 Merkle tree generator, root calculator, Merkle inclusion proof validator. |
| **Smart Contract** | [`contracts/VoteChainLedger.sol`](contracts/VoteChainLedger.sol) | Solidity smart contract deployed on Ethereum Sepolia for commitments and replay protection. |
| **Blockchain Client**| [`src/blockchain/ethereum.ts`](src/blockchain/ethereum.ts) | Ethers.js Sepolia RPC relayer, commitment transaction submission, on-chain verifier. |
| **Micro-Ledger** | [`src/blockchain/blockchain.ts`](src/blockchain/blockchain.ts) | Internal micro-blockchain ledger generator, block chaining, and hash continuity checker. |
| **Unit Tests** | [`tests/unit/`](tests/unit/) | 21 unit and security test suites covering all cryptographic, auth, and voting modules. |
| **Contract Tests** | [`tests/contracts/VoteChainLedger.test.ts`](tests/contracts/VoteChainLedger.test.ts) | 6 smart contract tests verifying registration, commitment recording, replay prevention. |
| **E2E Tests** | [`tests/e2e/`](tests/e2e/) | End-to-end integration, load test, offline recovery, and Phase 14 class election simulation tests. |
| **Documentation** | [`docs/`](docs/) | Complete architecture guides, phase reports, and deployment blueprints. |

---

## 5. End-to-End Voting Flow

```
1. Voter Registration ──> 2. Email Verification ──> 3. Eligibility Check
   (PSG Tech domain)      (Gmail SMTP 15m token)   (Admin class roster)
                                                            │
   ┌────────────────────────────────────────────────────────┘
   ▼
4. Candidate Selection (Voter Portal)
   ├── ONLINE: Generate BabyJubjub CDS ZK Proof ──> Encrypt AES-256-GCM (DEK)
   └── OFFLINE: Encrypt locally with WebCrypto AES-GCM ──> Store in IndexedDB
                                                            │
   ┌────────────────────────────────────────────────────────┘
   ▼
5. Server Validation & Processing
   ├── Verify Zero-Knowledge Proof (CDS Schnorr via Poseidon)
   ├── Double-Blind Database Commitment (voterId separated from ballot)
   └── Internal Micro-Blockchain Ledger Block Appended
            │
            ▼
6. Blockchain Commitment Relay
   └── Submit to Ethereum Sepolia (VoteChainLedger.sol) ──> Tx mined in block
            │
            ▼
7. Cryptographic Receipt Issued
   └── Voter receives immutable receipt (txHash, blockNumber, recordHash)
            │
            ▼
8. Election Closes & 2-of-3 Threshold Decryption
   ├── 0 or 1 share: Decryption strictly locked
   └── 2 distinct authority shares: DEK reconstructed via Lagrange GF(256)
            │
            ▼
9. Final Certified Tally & Merkle Tree Publication
   ├── Ballots decrypted in memory & results computed
   └── Balanced SHA-256 Merkle root published for universal public verification
```

---

## 6. Live Ethereum Sepolia Contract Details

- **Network**: Ethereum Sepolia Testnet (Chain ID `11155111`)
- **Contract Address**: [`0x7339F8B088A2835F26e158c9F96690395D80264D`](https://sepolia.etherscan.io/address/0x7339F8B088A2835F26e158c9F96690395D80264D)
- **Relayer Account**: `0xd9f43Cd01A317849e54DbcCB03380dA3EDE5E063`
- **Compiler**: Solidity `^0.8.20`
- **Verified On-Chain Functions**:
  - `recordVote(bytes32 electionId, bytes32 commitment)`
  - `commitmentUsed(bytes32 commitment) view returns (bool)`
  - `finalizeElection(bytes32 electionId, bytes32 merkleRoot, bytes32 resultsDigest)`
  - `getElection(bytes32 electionId) view returns (...)`

---

## 7. Phase 14 Final Simulation Summary

In Phase 14, VoteChain successfully completed a realistic classroom election simulation for 100 students:
- **Election**: Department of Computer Science & Engineering — Class Representative Election 2026
- **Voter Pool**: 100 synthetic students (`24CS001` – `24CS100`, `@psgtech.ac.in`)
- **Total Valid Ballots Tallied**: **100 / 100**
  - Online Cast: 95
  - Phase 13 Offline Synchronized: 5
- **Replay Protection**: 5 / 5 duplicate voting attempts strictly rejected
- **Ineligible Access Blocking**: 2 / 2 unauthorized accounts blocked
- **Live Sepolia Transaction**: Mined at Block `#11821078` (Tx: `0x3571994fb08cb269a5dea627643f39ac43d8da4b5a8d84dc0a4928c50819588a`)
- **Certified Final Tally**:
  - Aadhavan Ramanathan: 34 votes (34.0%)
  - Bhavana Sundaram: 34 votes (34.0%)
  - Chirag Mukhopadhyay: 32 votes (32.0%)
- **Verification**: 100 / 100 receipts valid; 100 / 100 Merkle inclusion proofs verified; 100 / 100 micro-blockchain blocks continuous.

---

## 8. Automated Test Suite Results

```
===============================================================================
                           VOTECHAIN TEST SUMMARY                              
===============================================================================
  Suite                                 Tests Run   Passed   Failed   Status
  -----------------------------------------------------------------------------
  Unit & Cryptographic Test Suite          143        143       0      PASS
  Smart Contract Automated Test Suite        6          6       0      PASS
  Phase 13 Real Offline Voting Suite         9          9       0      PASS
  Phase 14 End-to-End Simulation Suite      12         12       0      PASS
  Production Build (Next.js 16 Turbopack)   20 routes  20       0      PASS
===============================================================================
```

To run the tests locally:
```powershell
# Run all unit and security test suites
npm run test:unit

# Run smart contract automated test suite
npm run test:contracts

# Run Phase 13 persistent offline voting suite
npx tsx --test src/lib/offline-voting.test.ts

# Run production build and type checking
npm run build
```

---

## 9. Important Limitations & Prototype Scope

VoteChain is an educational and research prototype. To maintain scientific integrity, the following limitations are explicitly noted:
1. **Institutional Domain Authentication**: Proves possession of an `@psgtech.ac.in` email account via single-use token; does not independently establish biometric identity.
2. **Relayer Relies on Server Infrastructure**: In this prototype, transactions are relayed by a funded server wallet rather than individual voter wallets to eliminate the barrier of requiring students to hold cryptocurrency.
3. **Client Device Security**: While ballots are encrypted locally before transmission, compromised client endpoints with rootkit/keylogger access could observe candidate selections prior to encryption.
4. **Coercion Resistance**: The receipt proves that a vote was counted in the on-chain Merkle tree, but does not provide receipt-free coercion resistance (e.g. JCJ / Civitas fake credentials).
5. **Certification**: VoteChain is **not certified** for official public governmental elections.

---

## 10. License

This project is released for academic, research, and educational purposes.