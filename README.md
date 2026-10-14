# VoteChain: Privacy-Preserving Blockchain Electronic Voting System

> **Educational & Research Prototype Notice**: VoteChain is an end-to-end verifiable, privacy-preserving electronic voting prototype designed for university classroom elections, academic research, and institutional demonstrations. It is **not** certified for, nor intended to be used in, public governmental or national statutory elections.

---

## 1. Project Overview

VoteChain addresses the fundamental dilemma of electronic voting: **how to mathematically prove that an election was conducted fairly and votes were counted accurately without ever compromising any voter's secret choice**.

VoteChain achieves end-to-end verifiability, voter privacy, and tamper evidence by uniting five cryptographic pillars:

1. **Zero-Knowledge Proofs (ZKP)**: Proves mathematical validity of candidate choice on the BabyJubjub elliptic curve with Poseidon hashing without revealing which candidate was selected.
2. **Double-Blind Database Architecture**: Physical separation of voter participation records from anonymous encrypted ballot records; ballot records never contain voter identities.
3. **Multi-Authority Threshold Cryptography**: Splits per-election Data Encryption Keys (DEKs) across 3 independent trustees using Shamir's Secret Sharing over Galois Field $\text{GF}(256)$. Tallying is strictly locked until a 2-of-3 authority quorum submits valid shares matching the on-chain key commitment.
4. **Ethereum Smart Contract Ledger**: Every vote commitment is mined into a smart contract on the Ethereum Sepolia blockchain ([`VoteChainLedger.sol`](contracts/VoteChainLedger.sol)), providing immutable replay protection and decentralized timestamping.
5. **Universal & Individual Verifiability**: Balanced SHA-256 Merkle inclusion proofs allow any voter or public auditor to verify that a specific ballot is included in the certified on-chain tally without logging in.
6. **Downloadable Personal PDF Receipts**: Pure vector PDF 1.4 receipts providing proof of ballot inclusion with on-chain Ethereum transaction hash, block number, record hash, and Merkle root, while strictly guaranteeing candidate privacy.
7. **Real Persistent Offline Voting**: Client-side WebCrypto AES-256-GCM encryption with durable IndexedDB queueing, surviving browser restarts and automatically synchronizing to the blockchain upon network recovery.
8. **Independent Observer Monitoring**: Dedicated observer portal with scoped access codes, live turnout and block height monitoring, 15-second auto-refresh, and cryptographic tamper detection demonstrations.

---

## 2. Production Architecture

VoteChain is deployed across a modern serverless cloud infrastructure:

```text
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
2. **Application Server**: Hosted on Vercel. Enforces signed HTTP-only cookies, SameSite origin validation, CSRF protections, and strict role guards (`ADMIN`, `VOTER`, `AUTHORITY`, `OBSERVER`).
3. **Database Tier**: Hosted on Neon PostgreSQL Serverless with Prisma ORM. Separates voter participation from anonymous encrypted ballots.
4. **Blockchain Tier**: Ethereum Sepolia testnet executing compiled Solidity smart contract `VoteChainLedger.sol` at `0x7339F8B088A2835F26e158c9F96690395D80264D`.
5. **Email Delivery**: Automated institutional verification and trustee invitation dispatch via Gmail SMTP enforcing single-use time-limited verification tokens.

---

## 3. Technology Stack

- **Framework**: Next.js 16.3.6 (App Router, Turbopack)
- **UI & Frontend**: React 19, Tailwind CSS, Lucide Icons
- **Language**: TypeScript 5
- **Database**: PostgreSQL (Neon Serverless) via Prisma Client 6.12.0
- **Blockchain**: Solidity 0.8.37, Ethers.js 6.17.0, Ethereum Sepolia Testnet, Ganache (Local Dev)
- **Zero-Knowledge Proofs**: `circomlibjs` (BabyJubjub Twisted Edwards Curve, Poseidon Hash, CDS 1-of-$N$ Schnorr NIZKP)
- **Symmetric Cryptography**: AES-256-GCM with Authenticated Additional Data (AAD) & PBKDF2
- **Threshold Scheme**: Shamir's Secret Sharing over Galois Field $\text{GF}(256)$ with $0x11b$ irreducible polynomial
- **PDF Engine**: Pure, zero-dependency PDF 1.4 vector generator ([`src/backend/receipt/pdf-generator.ts`](src/backend/receipt/pdf-generator.ts))
- **Hashing & Merkle Trees**: SHA-256, Keccak-256, HMAC-SHA256, Balanced Binary Merkle Trees
- **Offline Storage**: Browser IndexedDB (`VoteChainOfflineDB`) via WebCrypto Subtle API
- **Authentication**: Institutional Email Verification, Bcrypt (12 rounds), HMAC session tokens

---

## 4. Key Workflows

### 4.1 Admin Election Setup & Publication
1. **Creation**: Admin creates an election (`DRAFT`), defining title, description, and time window. A 256-bit per-election Data Encryption Key (DEK) is generated and committed via SHA-256.
2. **Candidate Roster**: Admin configures candidates. Candidates can be dynamically edited or reordered until locked.
3. **Eligibility CSV Upload**: Admin selects an institutional CSV roster file. The UI retains the file reference, parses student IDs, deduplicates rows, and populates `ElectionEligibleVoter`.
4. **Trustee Assignment**: Admin assigns exactly 3 registered Authority accounts as trustees. Shamir's Secret Sharing over $\text{GF}(256)$ splits the DEK into 3 key shares (`x=1, 2, 3`).
5. **Lock & Activation**: Once candidates, eligibility, and 3 trustees are in place, the election is locked and transitioned to `ACTIVE`.
6. **Closing & Tallying**: When voting ends (or via "Close Election Now"), the election enters `CLOSED`. Ballot decryption remains strictly locked until at least 2 distinct authorities submit matching key shares.
7. **Publication**: Once the 2-of-3 threshold is satisfied, the admin officially publishes verified results (`RESULTS_PUBLISHED`), making final tallies visible to voters and observers.

### 4.2 Voter Registration, Authentication & Voting
1. **Registration**: Student submits Name, Student ID (`24CS001`), and institutional `@psgtech.ac.in` email at `/register`.
2. **Email Verification**: An automated Gmail SMTP message delivers a single-use 15-minute token link. Once validated, the voter account is activated.
3. **Ballot Access**: Voter logs in and opens `/portal`. The portal checks `ElectionEligibleVoter` for whitelisted active elections.
4. **Ballot Casting**:
   - **Online**: Generates a client-side BabyJubjub CDS Zero-Knowledge proof, encrypts the candidate choice via AES-256-GCM, stores the double-blind record, and relays the commitment to Ethereum Sepolia.
   - **Offline**: If network connectivity drops, the ballot is sealed locally with WebCrypto AES-GCM and stored in IndexedDB. Upon network restoration, it synchronizes automatically.
5. **Receipt**: An immutable receipt is issued containing Receipt ID, Vote Reference ID, Ethereum Tx Hash, and Block Number.

### 4.3 Authority Trustee Invitation & Threshold Sign-off
1. **Invitation**: Admin invites trustees from the Authorities console. External emails (e.g. Gmail) are fully accepted.
2. **Setup Link**: A single-use 48-hour token is emailed to the trustee pointing to `/authority/setup?token=...`.
3. **Registration**: Trustee sets full name and secure password (minimum 12 characters with uppercase, lowercase, number, and special character). Low-contrast light UI text is styled for WCAG compliance.
4. **Threshold Review**: In `/authority`, trustees inspect closed elections. Once 2 of 3 trustees submit their key shares, the master DEK is reconstructed via Lagrange interpolation, enabling final tally decryption.

### 4.4 Observer Access & Real-Time Monitoring
1. **Access Code**: Admin generates an election-scoped observer access code (`VC-OBS-XXXX-XXXX-XXXX`). Only its SHA-256 hash is stored.
2. **Validation**: Observer visits `/observe`, selects the election (or enters the code to auto-resolve), and authenticates. A rate-limited endpoint issues an HMAC-scoped session token.
3. **Live Dashboard**: Observers monitor turnout percentage, verified votes count, block height, chain validity, candidate roster (tallies withheld during active voting), and audit logs with 15-second auto-refresh.

### 4.5 Downloadable Personal Vote Receipt PDF
1. Once a voter has cast their ballot, a **Download PDF Receipt** option appears on their portal dashboard.
2. The server verifies voter authorization (`ElectionVoterParticipation` and `ElectionVote.voterId`), computes Merkle inclusion status, and generates a pure vector PDF.
3. **Candidate Choice Exclusion**: The candidate choice is strictly omitted from the PDF to guarantee that receipts cannot be used for vote selling or coercion.

### 4.6 Voter Results Viewing After Publication
1. Prior to official admin publication, candidate totals and winners are withheld across all voter, observer, and results pages.
2. Once the admin completes 2-of-3 threshold tallying and publishes the results (`RESULTS_PUBLISHED`), permitted voters can view the verified final tally, candidate vote counts, percentage bars, and official winner on `/portal` and `/results`.

---

## 5. Project Structure

```text
VoteChain/
├── contracts/                        # Solidity smart contract & EVM artifacts
│   ├── VoteChainLedger.sol           # Core on-chain ballot box with replay protection
│   └── VoteChainLedger.json          # Compiled contract ABI & bytecode
│
├── docs/                             # Architecture specifications & documentation
│   ├── HOW_VOTECHAIN_WORKS.md        # Technical walkthrough & cryptographic manual
│   ├── PHASE_14_FINAL_CLASS_ELECTION_REPORT.md  # 100-voter classroom simulation report
│   ├── PHASE_15_FINAL_SYSTEM_AUDIT.md # Comprehensive 17-section security audit
│   ├── VoteChain_Complete_Online_Deployment_Plan.md # Online deployment blueprint
│   └── VOTECHAIN_PHASE_COMPLETION.md # Complete verification matrix across all phases
│
├── prisma/                           # Database ORM & schema definitions
│   ├── schema.prisma                 # Double-blind PostgreSQL schema
│   ├── seed.ts                       # Database seeder for demo accounts
│   └── migrations/                   # Atomic SQL schema migrations
│
├── scripts/                          # Operational & cloud deployment utilities
│   ├── create-or-reset-admin.ts      # Secure admin password provisioning CLI (hidden input)
│   ├── deploy-contract.ts            # Sepolia contract compilation & deployment
│   ├── setup-testnet-wallet.ts       # Testnet relayer wallet generation & balance checker
│   ├── check-db-credentials.ts       # Neon serverless connection verifier
│   └── inspect-db.ts                 # Database state inspection utility
│
├── src/
│   ├── app/                          # Next.js App Router (UI pages & API endpoints)
│   │   ├── (pages)                   # /login, /register, /portal, /results, /audit, /observe, etc.
│   │   └── api/                      # REST endpoints for auth, elections, voting, receipts
│   │
│   ├── frontend/                     # Frontend client layer
│   │   └── components/               # React UI components (voter portal, tamper demo, qr code)
│   │
│   ├── backend/                      # Server-side business logic
│   │   ├── auth/                     # Registration, sessions, observer tokens, email dispatch
│   │   ├── voting/                   # Eligibility checks, CSV rosters, election validation
│   │   └── receipt/                  # Pure PDF 1.4 receipt generator
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
    ├── unit/                         # 29 unit & security test files (185 tests)
    └── contracts/                    # Smart contract automated test suite (6 tests)
```

---

## 6. Key Files — Where to Look

For evaluators, instructors, and security auditors, this table maps each key capability to its exact source file:

| Logical Area | Source File Path | Key Responsibilities & Logic |
| :--- | :--- | :--- |
| **Voter Portal & Results** | [`src/frontend/components/voter-portal-client.tsx`](src/frontend/components/voter-portal-client.tsx) | Candidate ballot selection, verified results card, winner display, offline buffering, PDF download trigger. |
| **PDF Receipt Generator** | [`src/backend/receipt/pdf-generator.ts`](src/backend/receipt/pdf-generator.ts) | Pure zero-dependency PDF 1.4 vector generator. Formats proofs, txHash, block number, and Merkle root; strictly excludes candidate choice. |
| **PDF Download Route** | [`src/app/api/voter/receipt/pdf/route.ts`](src/app/api/voter/receipt/pdf/route.ts) | Authorized receipt PDF download endpoint. Enforces voter-ballot binding and generates binary PDF stream. |
| **Observer Portal UI** | [`src/app/observe/page.tsx`](src/app/observe/page.tsx) | High-contrast observer dashboard, dual access code entry, 15s auto-refresh toggle, turnout metrics, block viewer, audit stream. |
| **Observer Token Engine** | [`src/backend/auth/observer-token.ts`](src/backend/auth/observer-token.ts) | Scoped HMAC token generation and verification tied to active `observerAccessCodeHash`. |
| **Public Results View** | [`src/app/results/page.tsx`](src/app/results/page.tsx) | Public integrity dashboard, candidate results with progress bars, audit digest, QR code, and interactive tamper demo. |
| **Zero-Knowledge Proofs** | [`src/security/zk-proof.ts`](src/security/zk-proof.ts) | BabyJubjub CDS 1-of-$N$ Schnorr proof generation and server-side verification using Poseidon hashing. |
| **Ballot Encryption** | [`src/security/encryption.ts`](src/security/encryption.ts) | Authenticated AES-256-GCM encryption with random IV and election-bound AAD. |
| **Threshold Custody** | [`src/security/threshold.ts`](src/security/threshold.ts) | Shamir's Secret Sharing over $\text{GF}(256)$ with $0x11b$ polynomial, Lagrange interpolation, mandatory 2-of-3 threshold quorum. |
| **Per-Election Keys** | [`src/security/election-keys.ts`](src/security/election-keys.ts) | Per-election Data Encryption Key (DEK) generation, key commitment hashing, and master envelope encryption. |
| **Smart Contract** | [`contracts/VoteChainLedger.sol`](contracts/VoteChainLedger.sol) | Solidity smart contract deployed on Ethereum Sepolia for commitments and replay protection. |
| **Blockchain Relayer** | [`src/blockchain/ethereum.ts`](src/blockchain/ethereum.ts) | Ethers.js Sepolia RPC client, commitment transaction submission, on-chain verifier. |
| **Offline Storage** | [`src/offline/indexeddb.ts`](src/offline/indexeddb.ts) | Browser IndexedDB queue (`VoteChainOfflineDB`), persistent pending vote management. |
| **Offline Sync** | [`src/offline/sync.ts`](src/offline/sync.ts) | Real network restoration listener, in-memory unsealing, server dispatch engine. |
| **Merkle Tree Proofs** | [`src/verification/merkle.ts`](src/verification/merkle.ts) | Balanced SHA-256 Merkle tree generator, root calculator, Merkle inclusion proof validator. |
| **Public Verifier** | [`src/app/verify/page.tsx`](src/app/verify/page.tsx) | Public receipt verifier allowing any citizen or voter to independently verify ballot inclusion without logging in. |
| **Admin Password CLI** | [`scripts/create-or-reset-admin.ts`](scripts/create-or-reset-admin.ts) | Interactive CLI provisioning admin credentials via hidden input with password confirmation. |

---

## 7. Setup & Deployment Guide

### 7.1 Prerequisites
- **Node.js**: Version 20.x or higher
- **Package Manager**: npm 10.x or higher
- **Database**: PostgreSQL 15+ (Neon Serverless recommended)
- **Ethereum Testnet**: An Ethereum Sepolia account with testnet ETH (for transaction gas)
- **Email Service**: Google Gmail account with a 16-character App Password (for verification emails)

### 7.2 Environment Variable Configuration
Create a `.env` file in the project root. **Never commit actual secret values to git.**

| Variable Name | Required | Description |
| :--- | :---: | :--- |
| `DATABASE_URL` | **Yes** | Connection-pooled PostgreSQL connection string (Neon port 5432 with pgbouncer and `sslmode=require`). |
| `DIRECT_URL` | **Yes** | Direct unpooled PostgreSQL connection string for Prisma schema migrations. |
| `SESSION_SECRET` | **Yes** | 64+ character random string for HMAC-SHA256 session cookie signing and observer tokens. |
| `KEY_ENCRYPTION_KEY` | **Yes** | 64-character hex string (32 bytes) used to seal per-election DEK envelopes on the server. |
| `BALLOT_ENCRYPTION_KEY` | Optional | Legacy fallback key for backward compatibility with pre-threshold elections. |
| `ETHEREUM_RPC_URL` | **Yes** | Ethereum Sepolia JSON-RPC endpoint URL (Infura, Alchemy, or public Sepolia node). |
| `ETHEREUM_ACCOUNT` | **Yes** | Public `0x...` address of the server relayer wallet sponsoring ballot transactions. |
| `ETHEREUM_PRIVATE_KEY` | **Yes** | Private key of the server relayer wallet (must hold Sepolia testnet ETH). |
| `VOTECHAIN_CONTRACT_ADDRESS` | **Yes** | Address of the deployed `VoteChainLedger.sol` contract on Sepolia. |
| `EMAIL_USER` | **Yes** | Gmail address for sending voter registration verification links. |
| `EMAIL_APP_PASSWORD` | **Yes** | 16-character Google App Password for the voter verification sender account. |
| `ADMIN_EMAIL_USER` | Optional | Gmail address for admin & authority invitations (defaults to `EMAIL_USER`). |
| `ADMIN_EMAIL_APP_PASSWORD` | Optional | Google App Password for admin sender (defaults to `EMAIL_APP_PASSWORD`). |
| `ADMIN_EMAIL` | Optional | Default administrator email identity (e.g. `admin.votechain@gmail.com`). |
| `NEXT_PUBLIC_APP_URL` | Optional | Canonical production base URL (e.g. `https://votechain.vercel.app`). Auto-detected on Vercel. |

### 7.3 Local Development Setup

```powershell
# 1. Clone repository & install dependencies
git clone <repository-url>
cd VoteChain
npm install

# 2. Synchronize database schema
npx prisma db push

# 3. Provision or reset the administrator password securely (interactive hidden prompt)
npx tsx --env-file=.env scripts/create-or-reset-admin.ts admin.votechain@gmail.com

# 4. Run automated test suite
npm test

# 5. Launch development server
npm run dev
```

Open `http://localhost:3000` in your web browser.

### 7.4 Production Deployment (Vercel)
1. Push code to the connected GitHub repository on branch `master`.
2. In the **Vercel Project Settings > Environment Variables**, configure all variables listed in Section 7.2.
3. Deploy. Vercel automatically runs `npm run build` using Next.js Turbopack.
4. Verify the live URL serves the new deployment with all security headers enabled.

---

## 8. Automated Test Suite Results

VoteChain includes comprehensive automated test coverage spanning cryptographic primitives, threshold custody, Zero-Knowledge proofs, contract execution, offline voting, and role boundaries:

```text
========================================================================================
                          VOTECHAIN AUTOMATED TEST SUITE                                
========================================================================================
  Suite Name                             Test File Reference             Tests   Status
  --------------------------------------------------------------------------------------
  Institutional Email Verification       registration.test.ts              13     PASS
  Class Eligibility Whitelisting         class-eligibility.test.ts          9     PASS
  One-Person-One-Vote & Auth             one-vote-auth.test.ts              8     PASS
  Production Security & Header Hardening phase6-security.test.ts            6     PASS
  Comprehensive Security Audit           phase11-security.test.ts          29     PASS
  Per-Election DEK Architecture          election-keys.test.ts              5     PASS
  2-of-3 Threshold Authority Matrix      threshold-authority-9-2.test.ts    4     PASS
  Mandatory Threshold Decryption Suite   threshold-mandatory-9-3.test.ts   15     PASS
  BabyJubjub CDS Zero-Knowledge Proofs   zk-proof.test.ts                   5     PASS
  AES-256-GCM Encrypted Ballots          encrypted-ballot.test.ts           5     PASS
  Balanced SHA-256 Merkle Trees          integrity.test.ts                  4     PASS
  Micro-Blockchain Continuity            blockchain.test.ts                 4     PASS
  CSRF Same-Origin Guards                csrf.test.ts                       4     PASS
  Voting Logic & Receipts                voting.test.ts                     4     PASS
  Role-Based Route Isolation             role-routing.test.ts               4     PASS
  Audit Trail & Public Results           audit.test.ts, results, etc.      28     PASS
  Persistent Offline Voting Suite        offline-voting.test.ts             9     PASS
  PDF Receipts & Observer Session Tokens voter-results-receipt-observer.ts  3     PASS
  Observer Access Code Lifecycle         observer-access.test.ts            1     PASS
  Smart Contract Automated Test Suite    contracts/VoteChainLedger.test.ts  6     PASS
  Production Turbopack Build             npm run build (35 routes)         35     PASS
========================================================================================
  TOTAL TESTS EXECUTED:                  185 Automated Tests + 35 Routes   0 FAILURES
========================================================================================
```

---

## 9. Security & Limitations

VoteChain is designed to demonstrate state-of-the-art cryptographic voting principles in an educational setting. To maintain scientific integrity, the following security guarantees and prototype limitations are explicitly noted:

### Security Guarantees
- **Ballot Secrecy**: The voter's candidate selection is encrypted locally before database persistence. Decoupled database architecture (`ElectionVoterParticipation` vs. `ElectionVote`) prevents linkage between voter identity and ballot choice.
- **Zero-Knowledge Validity**: CDS Schnorr proofs prove the ballot selects a legitimate candidate without disclosing the candidate index.
- **Tamper Evidence**: Ethereum Sepolia smart contract commitments and balanced Merkle trees make retrospective ballot alteration mathematically detectable.
- **Threshold Custody**: No single administrator can decrypt ballots; a quorum of at least 2 distinct authorities is strictly required to reconstruct the election key.
- **Coercion Mitigation in Receipts**: PDF and digital receipts confirm participation and inclusion proofs, but deliberately omit the voter's candidate choice to prevent vote-buying or coercion.

### Prototype Limitations
- **Institutional Identity Scope**: Authentication is based on possession of an `@psgtech.ac.in` email and student ID; it does not include in-person biometric authentication.
- **Server Relayer Trust for Gas**: Transactions are relayed by a centralized server wallet so students do not need cryptocurrency. While the relayer cannot alter encrypted ballots or falsify ZK proofs, a malicious relayer could theoretically delay transaction submission.
- **Client Endpoint Integrity**: While ballots are encrypted before transmission, a compromised client device (e.g. keylogger or malware) could observe user interaction before encryption occurs.
- **Official Certification**: VoteChain is an academic prototype and is **not certified** by governmental election authorities for statutory public elections.

---

## 10. License

This project is released for academic, research, and educational purposes.