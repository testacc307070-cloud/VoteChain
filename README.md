# VoteChain: Privacy-Preserving Blockchain Electronic Voting System

> **Educational & Academic Prototype Notice**: VoteChain is an end-to-end verifiable, privacy-preserving electronic voting prototype designed for institutional and classroom election research (specifically modelled on PSG College of Technology's `@psgtech.ac.in` domain). It is deployed across **Vercel** (serverless frontend/API), **Neon PostgreSQL** (cloud relational database), and **Ethereum Sepolia** (public testnet smart contract). It is designed to demonstrate cryptographic integrity, zero-knowledge proofs, multi-authority threshold key custody, and persistent offline voting. It is **not** designed or certified for national, governmental, or legally binding political elections.

---

## 1. Project Overview

VoteChain addresses the central dilemma of electronic voting: **how to mathematically prove that an election was conducted fairly and votes were counted accurately without ever compromising the secret choice of any individual voter.**

VoteChain achieves this through a multi-layered cryptographic and distributed architecture:

1. **Client-Side & Server Zero-Knowledge Proofs (ZKP)**: Uses Cramer-Damgård-Schoenmakers (CDS) 1-out-of-$N$ Disjunctive Non-Interactive Zero-Knowledge Proofs on the **BabyJubjub elliptic curve** with the **Poseidon hash function** (`circomlibjs`) to prove that a ballot contains a valid candidate choice without revealing which candidate was selected.
2. **Double-Blind Database Separation**: Physical decoupling between voter identity participation records (`ElectionVoterParticipation`) and anonymous encrypted ballots (`ElectionVote`). The vote record stores candidate ID as `null` and contains zero foreign keys or identifiers linking back to the student.
3. **Per-Election Keys & Mandatory 2-of-3 Threshold Authorities**: Each election generates a unique 256-bit cryptographically random Data Encryption Key (DEK) committed via SHA-256 (`keyCommitment`). The DEK is split into 3 Shamir shares over Galois Field $\text{GF}(256)$. Tallying is mathematically impossible without approvals from at least 2 distinct authorized trustees.
4. **Public Blockchain Commitment (Ethereum Sepolia)**: Every vote commitment is submitted to a Solidity smart contract (`VoteChainLedger.sol` at `0x7339F8B088A2835F26e158c9F96690395D80264D`) on the Ethereum Sepolia public testnet, providing immutable tamper resistance, replay prevention, and public verifiability.
5. **Real Persistent Offline Voting (Phase 13)**: Built with browser **IndexedDB** (`VoteChainOfflineDB`) and WebCrypto **AES-256-GCM** client-side encryption. Ballots queued during network disruptions survive page reloads and browser restarts with zero plaintext candidate choices stored on disk, and automatically synchronize upon network restoration.
6. **Universal & Individual Verifiability**: Balanced SHA-256 Merkle inclusion proofs allow any voter or public auditor to verify that their ballot receipt is permanently included in the election ledger without logging in.

---

## 2. Key Files — Where to Look (Teacher & Evaluator Guide)

The table below maps each core architectural component to its exact source file in the repository:

| Functional Area | Primary File(s) | Description |
| :--- | :--- | :--- |
| **Frontend / User Interface** | [`src/components/voter-portal-client.tsx`](src/components/voter-portal-client.tsx) | Client voter interface with live network detection, offline queueing, ZK proof status, and receipt display |
| | [`src/components/admin-dashboard.tsx`](src/components/admin-dashboard.tsx) | Administrator console for election lifecycle, candidate locking, and CSV eligibility upload |
| | [`src/components/authority-dashboard.tsx`](src/components/authority-dashboard.tsx) | Trustee key custody interface for reviewing tallies and submitting Shamir threshold shares |
| | [`src/components/observer-dashboard.tsx`](src/components/observer-dashboard.tsx) | Public observer dashboard showing micro-blockchain blocks, chain health, and tamper simulation |
| **Authentication & RBAC** | [`src/lib/session.ts`](src/lib/session.ts) | HMAC-SHA256 signed session token generation, verification, and HTTP-only cookie management |
| | [`src/lib/auth-validation.ts`](src/lib/auth-validation.ts) | PSG Tech `@psgtech.ac.in` domain validator, Student ID format parser, and password strength checks |
| | [`src/proxy.ts`](src/proxy.ts) | Next.js middleware enforcing role-based route guards (`/portal`, `/authority`, `/observer`) & CSP headers |
| | [`src/lib/csrf.ts`](src/lib/csrf.ts) | CSRF origin and referrer validation for all state-mutating HTTP requests |
| **Voter Registration & Verification** | [`src/lib/registration.ts`](src/lib/registration.ts) | Student voter registration pipeline, single-use 24-hour verification token generator, and resend logic |
| | [`src/lib/email.ts`](src/lib/email.ts) | Nodemailer Gmail SMTP integration (`votechain.verify@gmail.com`) with production URL formatting |
| **Eligibility & One-Person-One-Vote** | [`src/lib/eligibility.ts`](src/lib/eligibility.ts) | Multi-factor eligibility engine checking account status, email verification, and election whitelist |
| | [`src/lib/csv-eligibility.ts`](src/lib/csv-eligibility.ts) | Admin CSV parser for importing official class registers with deduplication and size limits |
| | [`src/app/api/voter/elections/[electionId]/vote/route.ts`](src/app/api/voter/elections/[electionId]/vote/route.ts) | Atomic vote submission handler enforcing participation uniqueness before ballot storage |
| **Ballot Encryption & Per-Election Keys** | [`src/lib/election-keys.ts`](src/lib/election-keys.ts) | Unique 256-bit DEK generation, AES-256-GCM envelope sealing, and SHA-256 `keyCommitment` verification |
| | [`src/lib/encrypted-ballot.ts`](src/lib/encrypted-ballot.ts) | AES-256-GCM ballot encryption with 12-byte random IVs, 16-byte auth tags, and `electionId` AAD binding |
| **Zero-Knowledge Proofs** | [`src/lib/zk-proof.ts`](src/lib/zk-proof.ts) | BabyJubjub elliptic curve + Poseidon hash CDS 1-of-N disjunctive Schnorr NIZKP (`circomlibjs`) |
| **Threshold Key Custody (2-of-3)** | [`src/lib/authority.ts`](src/lib/authority.ts) | Shamir's Secret Sharing over Galois Field GF(256), share splitting, coordinate deduplication, and tally reconstruction |
| **Real Offline Voting (Phase 13)** | [`src/lib/offline-storage.ts`](src/lib/offline-storage.ts) | Persistent browser IndexedDB queue (`VoteChainOfflineDB`) with isomorphic in-memory testing fallback |
| | [`src/lib/offline-encryption.ts`](src/lib/offline-encryption.ts) | WebCrypto AES-256-GCM client encryption with PBKDF2 device key envelope (`localKeyEnvelope`) |
| | [`src/lib/offline-sync.ts`](src/lib/offline-sync.ts) | Network reconnection listener (`online` event), in-memory unsealing, server dispatch, and auto-sync |
| **Public Blockchain (Ethereum Sepolia)** | [`contracts/VoteChainLedger.sol`](contracts/VoteChainLedger.sol) | Solidity smart contract recording vote commitments with duplicate prevention (`commitmentUsed`) |
| | [`src/lib/ethereum.ts`](src/lib/ethereum.ts) | Ethers.js v6 relayer submitting commitments to Sepolia contract (`0x7339F8B088A2835F26e158c9F96690395D80264D`) |
| **Micro-Blockchain & Integrity** | [`src/lib/blockchain.ts`](src/lib/blockchain.ts) | Application micro-blockchain linking votes into SHA-256 blocks with full chain hash continuity validation |
| | [`src/lib/voting.ts`](src/lib/voting.ts) | Deterministic cryptographic receipts (`recordHash`) and public receipt authenticity verification |
| | [`src/lib/integrity.ts`](src/lib/integrity.ts) | Balanced SHA-256 Merkle tree calculation, Merkle root commitment, and inclusion proof generation |
| | [`src/lib/qr.ts`](src/lib/qr.ts) | Scannable election verification QR code payload and URL generator |
| **Database Schema** | [`prisma/schema.prisma`](prisma/schema.prisma) | Prisma schema defining 7 core relational models, indexes, and unique constraints for Neon PostgreSQL |
| **Automated Test Suites** | [`src/lib/offline-voting.test.ts`](src/lib/offline-voting.test.ts) | 9 automated tests for Phase 13 IndexedDB storage, confidentiality, refresh recovery, and auto-sync |
| | [`contracts/VoteChainLedger.test.ts`](contracts/VoteChainLedger.test.ts) | 6 automated tests for Solidity smart contract logic on Ganache EVM |
| | [`src/lib/*.test.ts`](src/lib/) | 21 test files (143 tests) covering registration, CSRF, threshold math, ZK proofs, and security audits |
| **E2E & Simulation Harnesses** | [`scripts/verify-phase14-final-class-election.ts`](scripts/verify-phase14-final-class-election.ts) | 12-step realistic 100-voter class election simulation with Sepolia mining and 2-of-3 threshold tally |
| | [`scripts/load-test-classroom.ts`](scripts/load-test-classroom.ts) | Phase 12 high-concurrency load testing harness (~100 users, race conditions, micro-blockchain append) |

---

## 3. System Architecture

```
[ Voter / Admin / Authority / Observer Browser ]
         │
         │ HTTPS / TLS (Vercel Serverless Hosting)
         ▼
[ Next.js 16 App Router & API Gateway ]
   ├── Middleware: CSRF Guards, Role Routing, CSP / HSTS Headers
   ├── Cryptography: AES-256-GCM, BabyJubjub CDS ZKP, Shamir GF(256)
   │
   ├── Database: Neon Serverless PostgreSQL (ap-southeast-1)
   │     ├── User / VerificationToken (Bcrypt, Single-use tokens)
   │     ├── Election / ElectionCandidate (Per-election DEK, keyCommitment)
   │     ├── ElectionEligibleVoter (Class register whitelist)
   │     ├── ElectionVoterParticipation (Strict 1-per-voter constraint)
   │     ├── ElectionVote (Anonymized: candidateId = null, encryptedBallot)
   │     └── ElectionBlockchainBlock / AuditLog (Micro-blockchain ledger)
   │
   └── Blockchain: Ethereum Sepolia Testnet (Chain ID 11155111)
         ├── Contract: VoteChainLedger.sol (0x7339F8B088A2835F26e158c9F96690395D80264D)
         ├── Relayer: 0xd9f43Cd01A317849e54DbcCB03380dA3EDE5E063
         └── Immutable Commitment Storage: commitmentUsed(keccak256(ciphertext:proof))
```

---

## 4. Complete Voting Flow

```
1. REGISTRATION & VERIFICATION
   Student signs up with Student ID & @psgtech.ac.in email
   → Verification link sent via Gmail SMTP (votechain.verify@gmail.com)
   → Token verified, user activated as VOTER.

2. ELIGIBILITY
   Admin uploads official CSV class register for the election
   → System enforces voter whitelist check & active election window.

3. BALLOT CASTING (ONLINE or OFFLINE)
   a. Online: Voter selects candidate
      → BabyJubjub CDS ZK proof generated
      → Choice encrypted with election DEK (AES-256-GCM)
      → Decoupled submission: voter marked in Participation, anonymous vote stored.
   b. Offline (Phase 13): Network unavailable
      → Choice encrypted locally via WebCrypto AES-GCM
      → Ephemeral key sealed in PBKDF2 device envelope
      → Queued in IndexedDB (zero plaintext stored on disk)
      → Network restored: automatically unsealed, ZK proof verified, committed to ledger.

4. BLOCKCHAIN RECORDING
   Vote commitment relayed to Ethereum Sepolia contract
   → recordVote(electionId, commitment) mined into a block
   → Cryptographic receipt issued with Tx hash and block number.

5. ELECTION CLOSURE & 2-OF-3 THRESHOLD TALLY
   Admin closes election
   → 2 of 3 designated Authority Trustees submit their Shamir key shares
   → Lagrange interpolation over GF(256) reconstructs DEK
   → Key verified against SHA-256 keyCommitment
   → All 100 anonymous encrypted ballots decrypted and tallied.

6. INDEPENDENT VERIFICATION
   Merkle tree computed over all votes → Merkle root published
   → Any citizen or student checks receipt at /verify without logging in.
```

---

## 5. Technology Stack

- **Framework**: Next.js 16.3.6 (Turbopack, App Router)
- **UI Library**: React 19.0.0, Tailwind CSS, Lucide React
- **Language**: TypeScript 5.5+
- **Database & ORM**: PostgreSQL (Neon Serverless), Prisma ORM 6.12.0
- **Blockchain**: Solidity 0.8.28, Ethereum Sepolia Testnet, Ethers.js 6.17.0, Ganache (local tests)
- **Zero-Knowledge Cryptography**: `circomlibjs` 0.1.7 (BabyJubjub Edwards curve, Poseidon hash)
- **Symmetric Cryptography**: AES-256-GCM (Node.js `crypto` & browser WebCrypto `crypto.subtle`), PBKDF2
- **Threshold Scheme**: Shamir's Secret Sharing over $\text{GF}(256)$ with polynomial $0x11b$
- **Email Delivery**: Nodemailer 10.0.13 with Gmail SMTP TLS transport
- **Testing**: Node.js Test Runner (`tsx --test`)

---

## 6. How to Run the Project Locally

### Prerequisites
- Node.js 20.9+ or Node.js 22+
- Git
- PowerShell (Windows) or Bash (macOS/Linux)

### 1. Clone & Install Dependencies
```powershell
git clone https://github.com/testacc307070-cloud/VoteChain.git
cd VoteChain
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```powershell
Copy-Item .env.example .env
```
Ensure your `.env` contains the required database URL, session secret, and Sepolia configuration (sample variables provided in `.env.example`).

### 3. Generate Prisma Client
```powershell
npx prisma generate
```

### 4. Run Automated Test Suites
```powershell
# 1. Run all unit and security test suites (143 tests)
npm run test:unit

# 2. Run smart contract test suite (6 tests)
npm run test:contracts

# 3. Run Phase 13 persistent offline voting test suite (9 tests)
npx tsx --test src/lib/offline-voting.test.ts

# 4. Run Phase 14 full class election simulation
npx tsx scripts/verify-phase14-final-class-election.ts
```

### 5. Build for Production
```powershell
npm run build
```

### 6. Start the Local Server
```powershell
npm run dev
```
Open **http://localhost:3000** in your browser.

---

## 7. Phase 14 Final Simulation Summary

In Phase 14, the full VoteChain stack was tested in an isolated 100-student classroom election simulation ([`PHASE_14_FINAL_CLASS_ELECTION_REPORT.md`](PHASE_14_FINAL_CLASS_ELECTION_REPORT.md)):

- **Election ID**: `phase14-class-election-608641`
- **Total Voters Registered**: 100 (`24CS001` - `24CS100`)
- **Ballots Committed**: 100 (95 online + 5 Phase 13 offline synchronized)
- **Replay Protection**: 5/5 duplicate voting attempts strictly rejected
- **Ineligible Access**: 2/2 unauthorized accounts strictly blocked
- **Live Ethereum Sepolia Tx**: [`0x3571994fb08cb269a5dea627643f39ac43d8da4b5a8d84dc0a4928c50819588a`](https://sepolia.etherscan.io/tx/0x3571994fb08cb269a5dea627643f39ac43d8da4b5a8d84dc0a4928c50819588a) (Block `#11821078`)
- **Database Privacy**: 100% `candidateId === null` in `ElectionVote` table
- **Mandatory 2-of-3 Threshold Tally**: Approved by 2 authorities; reconstructed DEK validated against SHA-256 commitment; 100/100 ballots decrypted
- **Certified Tally**: Aadhavan Ramanathan: 34 votes (34.0%), Bhavana Sundaram: 34 votes (34.0%), Chirag Mukhopadhyay: 32 votes (32.0%)
- **Public Verifiability**: 100/100 receipts valid; Merkle inclusion proofs 100% verified.

---

## 8. Known Limitations & Research Boundaries

VoteChain is an educational prototype developed for computer science coursework and academic research. It has specific known limitations:

1. **Email Proof of Control**: Institutional email verification proves control of an `@psgtech.ac.in` account; it does not independently verify biometric or physical human presence.
2. **Single Server Relayer**: In this prototype, blockchain transactions are signed and submitted to Sepolia by a designated relayer address (`0xd9f43Cd01A317849e54DbcCB03380dA3EDE5E063`), meaning gas fees are sponsored rather than requiring voter MetaMask wallets.
3. **Coercion Resistance**: While the database prevents anyone from proving who a voter selected, the receipt confirms *that* a ballot was included. It does not provide receipt-free coercion resistance (such as JCJ/Civitas-style fake credentials).
4. **Target Scope**: Designed for classroom and institutional student body elections (~100–500 voters). It is not designed or certified for national public government elections.