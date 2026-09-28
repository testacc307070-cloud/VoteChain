# VoteChain: Privacy-Preserving Blockchain Electronic Voting System

> **Local Prototype Notice**: This project is operating within a **100% verified local prototype scope**. All services (Next.js web application, PostgreSQL database, Ganache Ethereum blockchain node) run locally on your system. It is designed for educational and research demonstration, and does not require internet access, real cryptocurrency, or third-party cloud services.

---

## 1. Project Overview

VoteChain is an end-to-end verifiable, privacy-preserving electronic voting prototype designed for universities and institutions. It solves the fundamental dilemma of electronic voting: **how to prove an election was conducted fairly without compromising any voter's secret choice**.

VoteChain achieves this by combining:
- **Zero-Knowledge Proofs (ZKP)**: Proves that a voter selected a valid candidate without revealing the candidate choice.
- **Double-Blind Database Architecture**: Physical separation between voter participation records and anonymous encrypted ballots.
- **Multi-Authority Threshold Cryptography**: Splits the master ballot decryption key across multiple trustees using Shamir's Secret Sharing over Galois Field $\text{GF}(256)$. No administrator or trustee can decrypt ballots before election closure.
- **Consortium Ethereum Smart Contract**: Every vote commitment is mined into a block on an Ethereum-compatible ledger ([`VoteChainLedger.sol`](contracts/VoteChainLedger.sol)), providing immutable replay protection and proof of recording.
- **Universal & Individual Verifiability**: Balanced SHA-256 Merkle inclusion proofs allow any voter or public auditor to verify that a ballot is included in the official on-chain result without logging in.

---

## 2. System Architecture (Local Consortium Stack)

```
[ Voter / Admin Browser ]  (Client Tier: React 19 UI + BabyJubjub ZK Prover)
           │
           │ HTTP REST / Cookies (Port 3000)
           ▼
[ Next.js API Gateway ]    (Server Tier: CSRF, CSP, Auth, Route Handlers)
      │               │
      │ SQL Port 5433 │ JSON-RPC Port 8545
      ▼               ▼
[ PostgreSQL 18 DB ]  [ Ganache EVM Node ]
(Users, Ballots,       (VoteChainLedger.sol,
 Audit Trail)           Mined Blocks, Commitments)
```

1. **Client Tier**: Runs in the browser with Next.js 16 and React 19. Generates client-side zero-knowledge proofs on the BabyJubjub elliptic curve.
2. **Application Server**: Next.js route handlers enforce signed HTTP-only cookies, nonce-based Content Security Policy, and CSRF origin validation.
3. **Database Tier**: PostgreSQL 18 handles relational state with Prisma 6 migrations.
4. **Blockchain Tier**: Ganache local Ethereum node (port 8545) executes compiled Solidity smart contracts.

---

## 3. Verified DEMO Credentials (For Local Testing)

All credentials listed below are **DEMO credentials** intended strictly for local testing and evaluation. They are seeded automatically by `npm run db:seed`:

| Role | DEMO Email | DEMO Password | Assigned Dashboard | Permissions & Scope |
|---|---|---|---|---|
| **DEMO Administrator** | `admin@votechain.local` | `adminPassword123!` | `/` (Admin Console) | Create elections, lock candidates, enroll voters; cannot vote |
| **DEMO Voter 1 (Alice)** | `voter@votechain.local` | `voterPassword123!` | `/portal` (Voter Portal) | Enter ballot box, cast secret ballot with ZKP, view receipt |
| **DEMO Voter 2 (Bob)** | `voter2@votechain.local` | `demoPassword123!` | `/portal` (Voter Portal) | Second voter for double-vote and threshold tally testing |
| **DEMO Observer** | `observer@votechain.local` | `observerPassword123!` | `/observer` (Audit Dashboard) | Audit ledger blocks, inspect chain integrity, run tamper demo |
| **DEMO Authority 1** | `authority@votechain.local` | `authorityPassword123!` | `/authority` (Key Custody) | Trustee holding Shamir Key Share 1; submits closure approval |
| **DEMO Authority 2** | `authority2@votechain.local` | `demoPassword123!` | `/authority` (Key Custody) | Trustee holding Shamir Key Share 2; submits closure approval |
| **DEMO Authority 3** | `authority3@votechain.local` | `demoPassword123!` | `/authority` (Key Custody) | Trustee holding Shamir Key Share 3; submits closure approval |

> **Security Note**: Never use these DEMO passwords in production or expose actual production keys. In production, each authority and voter would maintain their own independent, private credentials.

---

## 4. Prerequisites & Local Setup

### Prerequisites
- Git
- Node.js 20.9 or newer (npm is included)
- Docker Desktop with Docker Compose v2.20+ (for `--wait`), or a local PostgreSQL 16+ server
- PowerShell on Windows; macOS/Linux users can use equivalent shell commands
- Ports 3000, 5433, and 8545 available locally

### Clone and install (Windows PowerShell)
```powershell
git clone https://github.com/testacc307070-cloud/VoteChain.git
cd VoteChain
npm ci
Copy-Item .env.example .env
```

`npm ci` generates the Prisma Client as part of installation.

`.env.example` contains local-only DEMO settings that match the credentials below. It is safe for this local prototype, but its sample secrets and passwords must never be reused for a real deployment. `.env` is ignored by Git.

### Start PostgreSQL
From the project directory:
```powershell
docker compose up -d --wait postgres
```

Compose creates the `votechain` database and user and publishes PostgreSQL on `127.0.0.1:5433`, matching `DATABASE_URL` in `.env.example`. To use an existing local PostgreSQL server instead, create a database and user, then edit only `DATABASE_URL` in `.env` to match that server.

### Start Ganache and deploy the contract
Open a second terminal in the project directory and leave Ganache running:
```powershell
npm run blockchain:node
```

Back in the first terminal, deploy the contract to that local chain:
```powershell
npm run blockchain:deploy
```

Copy the printed `VoteChainLedger` address into `VOTECHAIN_CONTRACT_ADDRESS` in `.env`. Each fresh Ganache chain needs its own deployment address. The deployment script compiles `contracts/VoteChainLedger.sol` and writes a generated artifact under `contracts/`; that artifact is intentionally not committed.

### Initialize the database and start the app
```powershell
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Open **http://localhost:3000**. Keep both the PostgreSQL service and Ganache terminal running while using VoteChain. For a local PostgreSQL installation instead of Compose, start that service before migrating. To stop the Compose database later, run `docker compose down` (this preserves its local data volume).

---

## 5. Complete Local Voting & Tally Workflow

1. Sign in as the DEMO Administrator and create an election. Add candidates, set voter eligibility, lock the candidate list, and activate the election.
2. Sign in as DEMO Voter 1 (Alice) or DEMO Voter 2 (Bob) at `/login`, open `/portal`, and cast a ballot. The client creates the proof and encrypted ballot; the server records the vote commitment on the local Ganache chain and returns a receipt.
3. As administrator, close the election. Sign in as DEMO Authority 1 and DEMO Authority 2 and submit their approvals. The 2-of-3 quorum reconstructs the tally key, decrypts ballots, and publishes the result and Merkle root.
4. Visit `/results` to inspect the tally and QR verification code. At `/verify`, submit the ballot receipt to check its inclusion without logging in.
5. Sign in as the DEMO Observer at `/observer` to inspect audit and chain integrity. The second voter and third authority can be used for additional eligibility, double-vote, and quorum demonstrations.

The election UI and API routes control the election transitions; keep this workflow local because the bundled demo accounts and development chain are public/test-only.

---

## 6. Testing & Build Commands

VoteChain includes an automated test suite covering unit tests, cryptography, and smart contracts:

```powershell
# Run all automated unit and contract tests (50/50 passing)
npm test

# Run real local end-to-end lifecycle verification script
npx tsx scripts/verify-real-e2e.ts

# Run offline fault tolerance & transaction recovery verification script
npx tsx scripts/verify-offline-recovery.ts

# Run production build check
npm run build
```

---

## 7. Current Feature Status: 100% Verified Local Prototype Scope

- [x] **PostgreSQL Database**: Relational schema, Prisma migrations, 6 core tables operational.
- [x] **4 Distinct Roles**: Admin, Voter, Authority, Observer with strict route guards.
- [x] **Zero-Knowledge Proofs**: BabyJubjub elliptic curve + Poseidon hash CDS 1-of-N NIZKP.
- [x] **Threshold Key Management**: Shamir's Secret Sharing over GF(256) (AES polynomial `0x11b`).
- [x] **Ethereum Smart Contract**: `VoteChainLedger.sol` deployed on Ganache; duplicate commitment protection verified.
- [x] **Double-Blind Voter Privacy**: Decoupled `ElectionVoterParticipation` and `ElectionVote`.
- [x] **Merkle Verifiability**: SHA-256 balanced Merkle trees and inclusion proofs.
- [x] **Offline Resilience**: Client fault buffer simulation and transaction recovery sync.
- [x] **Tamper Detection**: Observer simulation detecting broken hash chains.

---

## 8. Known Limitations & Local Scope

- **Local Consortium Environment**: Ganache runs locally on port 8545. It is not connected to Ethereum Mainnet or public testnets yet.
- **Single Signer**: In local development, transactions are relayed by the server's configured signer key.
- **ZK Circuit Architecture**: ZKP is implemented via Cramer-Damgård-Schoenmakers disjunctive Schnorr proofs on the BabyJubjub curve rather than snarkjs compiled circuit binaries.
- **Double-Blind Separation**: The database separates voter participation records from anonymous encrypted ballot records; the ballot record does not contain voter ID.