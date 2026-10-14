# VoteChain: Educational Electronic Voting Prototype

> **Educational & research prototype:** VoteChain demonstrates verifiable voting concepts for classroom and institutional demonstrations. It is not a certified election system and must not be used for governmental, statutory, or other high-stakes elections.

---

## 1. Project Overview

VoteChain is a classroom-election prototype for exploring how authentication, ballot privacy, independent checks, and tamper-evident records can work together. It is an educational implementation, not a guarantee that an election is fair or that a ballot is secret under every threat model.

Implemented features include:

- Student registration, institutional-domain validation, email verification, and role-based access for voters, administrators, authorities, and observers.
- Election-specific eligible voter rosters imported from CSV, one-vote-per-election enforcement, and election/candidate management.
- Encrypted ballots and candidate-validity proofs; an election-specific key is protected by a 2-of-3 trustee approval workflow for tallying.
- Ethereum Sepolia transaction commitments, transaction-backed vote receipts, Merkle verification, audit views, and tamper-detection demonstrations.
- Offline ballot queueing in browser IndexedDB with local encryption and synchronization when connectivity returns. A queued offline ballot is pending until the server accepts it.
- Responsive layouts, downloadable PDF vote receipts, scoped observer access codes and monitoring, and official candidate totals displayed after results are published.

---

## 2. Architecture

The deployed application uses the following components:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         CLIENT TIER (Web Browser)                        │
│   React 19 UI  •  BabyJubjub CDS ZK Prover  •  IndexedDB Offline Queue   │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ HTTPS / Signed Session Cookies
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    APPLICATION (Vercel deployment)                      │
│             Next.js App Router • Role guards • Security headers          │
└───────────────────────┬──────────────────────────┬───────────────────────┘
                        │                          │
           SQL over TLS │ Pooler (Port 5432)       │ JSON-RPC (Sepolia)
                        ▼                          ▼
┌────────────────────────────────┐       ┌────────────────────────────────┐
│   DATABASE TIER (Neon Cloud)   │       │ BLOCKCHAIN (Sepolia testnet)  │
│   PostgreSQL via Prisma        │       │ VoteChainLedger smart contract │
│   • Accounts & election data   │       │ • Vote commitments            │
│   • Eligibility & participation│       │ • Replay protection           │
│   • Votes, trustees & audit    │       │                                │
└────────────────────────────────┘       └────────────────────────────────┘
```

1. **Web application:** Next.js and React run on Vercel; server routes validate sessions, roles, eligibility, and voting requests.
2. **Database:** PostgreSQL, accessed through Prisma, stores accounts, election configuration, eligibility, vote records, trustee approvals, and audit data.
3. **Blockchain:** The server connects to Ethereum Sepolia through an RPC provider and the Solidity `VoteChainLedger` contract. Relayer configuration is server-side.
4. **Email:** Nodemailer sends verification and invitation messages through configured SMTP credentials.

---

## 3. Technology Stack

- **Framework**: Next.js 16.3.6 (App Router, Turbopack)
- **UI & Frontend**: React 19, Tailwind CSS 4, Lucide React
- **Database**: PostgreSQL (Neon Serverless) via Prisma Client 6.12.0
- **Blockchain**: Solidity 0.8.x, Ethers.js 6, Ethereum Sepolia testnet, Ganache (local development)
- **Zero-Knowledge Proofs**: `circomlibjs` (BabyJubjub Twisted Edwards Curve, Poseidon Hash, CDS 1-of-$N$ Schnorr NIZKP)
- **Symmetric Cryptography**: AES-256-GCM with Authenticated Additional Data (AAD) & PBKDF2
- **Threshold Scheme**: Shamir's Secret Sharing over Galois Field $\text{GF}(256)$ with $0x11b$ irreducible polynomial
- **Hashing & Merkle Trees**: SHA-256, Keccak-256, HMAC-SHA256, Balanced Binary Merkle Trees
- **Offline Storage**: Browser IndexedDB (`VoteChainOfflineDB`) via WebCrypto Subtle API
- **Authentication and email**: bcryptjs, HMAC-signed HTTP-only sessions, Nodemailer
- **Hosting**: Vercel (application), Neon (managed PostgreSQL), Ethereum Sepolia (testnet ledger)

---

## 4. Project Structure

VoteChain follows a modular, layer-separated architecture designed for pedagogical clarity, code maintainability, and security auditability:

```
VoteChain/
├── contracts/                        # Solidity smart contract & EVM artifacts
│   ├── VoteChainLedger.sol           # Core on-chain ballot box with replay protection
│
├── docs/                             # Architecture specifications & phase audit reports
│   ├── HOW_VOTECHAIN_WORKS.md        # Deep-dive cryptographic & architectural guide
│   ├── PHASE_14_FINAL_CLASS_ELECTION_REPORT.md  # 100-voter classroom simulation report
│   ├── PHASE_15_FINAL_SYSTEM_AUDIT.md # Comprehensive 17-section security audit
│   ├── VoteChain_Complete_Online_Deployment_Plan.md # Online deployment blueprint
│   └── VOTECHAIN_PHASE_COMPLETION.md # Complete 15-phase verification matrix
│
├── prisma/                           # Database ORM & schema definitions
│   ├── schema.prisma                 # PostgreSQL schema and relations
│   ├── seed.ts                       # Optional development seed data
│   └── migrations/                   # Atomic SQL schema migrations
│
├── scripts/                          # Local setup and operational utilities
│   ├── deploy-contract.ts            # Optional local/testnet contract deployment
│   ├── create-or-reset-admin.ts      # Admin setup with hidden password prompt
│   └── inspect-db.ts                 # Database inspection utility
│
├── src/
│   ├── app/                          # Next.js App Router (UI pages & API endpoints)
│   │   ├── portal/, results/, verify/ # Voter, published results, receipt verification
│   │   ├── observe/, observer/       # Access-code observer and signed-in dashboard
│   │   └── api/                      # Auth, admin, authority, voting and receipt APIs
│   │
│   ├── frontend/                     # Frontend client layer
│   │   └── components/               # React UI components (portal, manager, tamper-demo)
│   │
│   ├── backend/                      # Server auth, voting, eligibility and PDF receipts
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
│       └── qr.ts                     # Verification QR reference generator
│
└── tests/                            # Automated test suites
    ├── unit/                         # Unit and feature tests
    ├── contracts/                    # Smart contract tests
    └── e2e/                          # Full E2E verification & classroom load tests
```

---

## 5. Key Files — Where to Look

For evaluators, instructors, and security auditors, this table maps each logical area to its final file path:

| Area | Final File Path | Primary Responsibility & Contents |
| :--- | :--- | :--- |
| **Frontend UI** | [`src/app/portal/page.tsx`](src/app/portal/page.tsx) | Voter portal page rendering active election ballots and eligibility state. |
| **Frontend UI** | [`src/frontend/components/voter-portal-client.tsx`](src/frontend/components/voter-portal-client.tsx) | Client component managing candidate selection, offline queueing, and auto-sync. |
| **Frontend UI** | [`src/app/results/page.tsx`](src/app/results/page.tsx) | Results and integrity page; candidate totals are shown after publication. |
| **Frontend UI** | [`src/app/verify/page.tsx`](src/app/verify/page.tsx) | Public receipt verifier allowing any citizen/voter to verify receipts without logging in. |
| **Frontend UI** | [`src/app/authority/page.tsx`](src/app/authority/page.tsx) | Trustee dashboard for election approvals and threshold tally authorization. |
| **Frontend UI** | [`src/app/observe/page.tsx`](src/app/observe/page.tsx) | Scoped observer access-code flow and election monitoring. |
| **Frontend UI** | [`src/app/observer/page.tsx`](src/app/observer/page.tsx) | Signed-in observer dashboard with ledger checks and tamper demonstration. |
| **Admin UI** | [`src/frontend/components/election-manager.tsx`](src/frontend/components/election-manager.tsx) | Election setup, roster upload, trustee assignment, invitations, and lifecycle actions. |
| **Authentication** | [`src/backend/auth/registration.ts`](src/backend/auth/registration.ts) | Student registration, institutional domain validation, single-use token lifecycle. |
| **Authentication** | [`src/backend/auth/session.ts`](src/backend/auth/session.ts) | HMAC-SHA256 signed session cookies, cookie validation, expiration checking. |
| **Authentication** | [`src/backend/auth/role-routing.ts`](src/backend/auth/role-routing.ts) | Role boundary guards isolating `VOTER`, `ADMIN`, `AUTHORITY`, and `OBSERVER`. |
| **Voting API** | [`src/app/api/voter/elections/[electionId]/vote/route.ts`](src/app/api/voter/elections/[electionId]/vote/route.ts) | Core voting API handling ZK validation, encryption, Sepolia relay, and micro-blockchain append. |
| **Voting Logic** | [`src/backend/voting/voting.ts`](src/backend/voting/voting.ts) | Vote submission validator, receipt generator, deterministic receipt hash verifier. |
| **Eligibility** | [`src/backend/voting/eligibility.ts`](src/backend/voting/eligibility.ts) | Per-election class roster whitelist verifier and voter eligibility checking. |
| **Database** | [`src/database/prisma.ts`](src/database/prisma.ts) | Singleton Prisma client with connection pooling for PostgreSQL. |
| **Database Schema** | [`prisma/schema.prisma`](prisma/schema.prisma) | PostgreSQL models, relations, unique constraints, eligibility, votes, and trustee approvals. |
| **Ballot Encryption**| [`src/security/encryption.ts`](src/security/encryption.ts) | AES-256-GCM ballot encryption with random IV, authTag, and election AAD binding. |
| **Election Keys** | [`src/security/election-keys.ts`](src/security/election-keys.ts) | Per-election Data Encryption Key (DEK) generator, master envelope, key commitments. |
| **Zero-Knowledge** | [`src/security/zk-proof.ts`](src/security/zk-proof.ts) | BabyJubjub CDS 1-of-$N$ Schnorr proof generator and server-side verifier via Poseidon. |
| **Threshold Custody**| [`src/security/threshold.ts`](src/security/threshold.ts) | 2-of-3 Shamir Secret Sharing over $\text{GF}(256)$, share validation, Lagrange interpolation. |
| **Offline Storage**| [`src/offline/indexeddb.ts`](src/offline/indexeddb.ts) | Browser IndexedDB queue (`VoteChainOfflineDB`), persistent pending vote management. |
| **Offline Encryption**| [`src/offline/offline-encryption.ts`](src/offline/offline-encryption.ts) | WebCrypto AES-256-GCM device encryption, PBKDF2 local key envelope unsealing. |
| **Offline Sync** | [`src/offline/sync.ts`](src/offline/sync.ts) | Real network restoration listener, in-memory unsealing, server dispatch engine. |
| **Receipts** | [`src/verification/receipts.ts`](src/verification/receipts.ts) | Deterministic receipt hash computation and validation. |
| **PDF Receipts** | [`src/backend/receipt/pdf-generator.ts`](src/backend/receipt/pdf-generator.ts) | Server-side PDF receipt generation. |
| **Receipt API** | [`src/app/api/voter/receipt/pdf/route.ts`](src/app/api/voter/receipt/pdf/route.ts) | Authorized voter/admin PDF download endpoint. |
| **Merkle Trees** | [`src/verification/merkle.ts`](src/verification/merkle.ts) | Balanced SHA-256 Merkle tree generator, root calculator, Merkle inclusion proof validator. |
| **Smart Contract** | [`contracts/VoteChainLedger.sol`](contracts/VoteChainLedger.sol) | Solidity smart contract deployed on Ethereum Sepolia for commitments and replay protection. |
| **Blockchain Client**| [`src/blockchain/ethereum.ts`](src/blockchain/ethereum.ts) | Ethers.js Sepolia RPC relayer, commitment transaction submission, on-chain verifier. |
| **Micro-Ledger** | [`src/blockchain/blockchain.ts`](src/blockchain/blockchain.ts) | Internal micro-blockchain ledger generator, block chaining, and hash continuity checker. |
| **Unit Tests** | [`tests/unit/`](tests/unit/) | Feature and unit tests for auth, voting, receipts, observers, and cryptography. |
| **Contract Tests** | [`tests/contracts/VoteChainLedger.test.ts`](tests/contracts/VoteChainLedger.test.ts) | 6 smart contract tests verifying registration, commitment recording, replay prevention. |
| **E2E Tests** | [`tests/e2e/`](tests/e2e/) | End-to-end integration, load test, offline recovery, and Phase 14 class election simulation tests. |
| **Documentation** | [`docs/`](docs/) | Complete architecture guides, phase reports, and deployment blueprints. |

---

## Election, voting, and oversight workflows

1. **Admin setup and activation:** Create an election, set its dates, add candidates, upload the election's eligible-voter CSV, assign trustee authorities, and configure observer access. Review and activate the election through the admin controls.
2. **Voter registration and eligibility:** A student registers with the configured institutional email and verifies the address with a one-time email link. For each election, the server checks the account against that election's uploaded roster.
3. **Voting:** The voter selects a candidate in the portal. Online submissions contain the encrypted ballot and validity proof, which the server validates before recording participation, vote metadata, an internal chained block, and a Sepolia commitment. Database constraints and server checks enforce one accepted vote per voter/election.
4. **Offline synchronization:** If disconnected, the browser stores an encrypted pending ballot in IndexedDB. It retries synchronization on reconnection; until the server accepts it, the queued ballot is not a confirmed vote.
5. **Receipts:** After acceptance, the voter can view the transaction-backed receipt, use the verification page, and download a PDF receipt. The PDF endpoint is restricted to the voter who participated in the election or an administrator.
6. **Authority lifecycle:** Administrators invite authority accounts by email. Invitees use the invitation link to activate/set up their account. Administrators assign trustees to elections; after closing, the required distinct authorities submit approvals/key shares to authorize a modern election tally.
7. **Observers and results:** An observer can use an election-scoped access code at `/observe` or sign in for the `/observer` dashboard. Observers can inspect status, turnout and integrity information. Closing alone does not make candidate totals official; the authorized administrator publishes results after threshold approval, after which totals are available at `/results`.

---

## Setup and deployment

### Prerequisites

- Node.js 20.9 or newer and npm.
- PostgreSQL (local or Neon).
- An Ethereum JSON-RPC endpoint and a deployed `VoteChainLedger` contract for blockchain voting. Ganache and the contract deployment script support local/test development.
- SMTP credentials if registration verification or invitation email is being exercised.

### Environment variables

Create a private `.env` from `.env.example` and replace its example settings. Never commit `.env`, put credentials in documentation, or expose server-only secrets through `NEXT_PUBLIC_*`.

| Variable names | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string used by Prisma. |
| `SESSION_SECRET` | HMAC session signing secret (at least 32 characters). |
| `BALLOT_ENCRYPTION_KEY` | Server-side ballot encryption key (at least 32 characters). |
| `KEY_ENCRYPTION_KEY` | Optional separate key for election-key envelopes; otherwise the ballot key is used. |
| `NEXT_PUBLIC_APP_URL` | Optional application base URL for generated email links. |
| `EMAIL_USER`, `EMAIL_APP_PASSWORD` | SMTP credentials for voter verification email. |
| `ADMIN_EMAIL_USER`, `ADMIN_EMAIL_APP_PASSWORD` | Optional SMTP credentials for administration/invitation email. |
| `ETHEREUM_RPC_URL` | Sepolia or local EVM JSON-RPC endpoint. |
| `VOTECHAIN_CONTRACT_ADDRESS` | `VoteChainLedger` address deployed on the configured network. |
| `ETHEREUM_PRIVATE_KEY` | Optional server-only relayer key when the RPC does not offer an unlocked account. |
| `ETHEREUM_ACCOUNT` | Optional account address when using an unlocked local node account. |
| `MIN_PASSWORD_LENGTH` | Optional registration password-length policy override. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Optional administrator credentials for local Prisma seeding. |
| `VOTER_EMAIL`, `VOTER_PASSWORD`, `OBSERVER_EMAIL`, `OBSERVER_PASSWORD`, `AUTHORITY_EMAIL`, `AUTHORITY_PASSWORD` | Optional local demo seed account settings. Use private, unique values. |

Vercel supplies `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL`. Set application secrets in Vercel project environment settings, not in Git.

### Local development

```powershell
npm ci
npx prisma generate
npm run db:migrate
# Optional: seed a development database after configuring private seed credentials.
npm run db:seed
npm run dev
```

Open `http://localhost:3000`. For a production-like local run, use `npm run build` followed by `npm run start`.

### Production deployment

Connect the GitHub repository to the existing Vercel project and use the production branch (`master`). Configure the production environment variables above and confirm Neon and Sepolia settings in Vercel. Vercel Git integration creates a production deployment when commits reach the production branch. For a schema change, commit a reviewed Prisma migration and intentionally run `npm run db:migrate` against the target database; do not use `db push` as a production migration substitute. Documentation-only changes require no database migration.

---

## Blockchain network

The hosted configuration uses Ethereum Sepolia (chain ID `11155111`) and `VoteChainLedger.sol`. Contract and RPC settings are supplied through environment variables. Local development can use Ganache.

## Historical classroom simulation

The Phase 14 classroom simulation is documented in [`docs/PHASE_14_FINAL_CLASS_ELECTION_REPORT.md`](docs/PHASE_14_FINAL_CLASS_ELECTION_REPORT.md). Treat that report as a historical project record, not a current deployment certification.

## Validation commands

Available for maintainers; outcomes depend on the current checkout and configured services:

```powershell
npm run test:unit
npm run test:contracts
npm run build
```

---

## Admin management and election controls

VoteChain provides secure administrative capabilities for classroom election administrators:

### Administrator account
- Sign in using an administrator account provisioned for the deployment.
- To create or reset an administrator locally, run the script below. It prompts for the password without echoing it; do not pass a password as a command-line argument.
  ```powershell
  npx tsx --env-file=.env scripts/create-or-reset-admin.ts [email]
  ```

### 2-of-3 Authority Trustee Management
- **Dashboard Navigation**: Access via the **Authorities** tab on the Admin Dashboard (`/`).
- **Invitations and activation**: The administrator invites authority accounts by email; invitees use the single-use invitation link to set up and activate their accounts.
- **Trustee assignment**: Assign authority accounts to the election before it is closed for threshold tallying.
- **2-of-3 custody**: Three trustee slots are available; at least two distinct valid approvals/shares are required to tally a modern election.
- **Role Isolation**: Authority accounts are strictly segregated from voters and cannot be enrolled as eligible voters.

### Election Lifecycle Controls
- **Close Election Now**: Allows an administrator to conclude an `ACTIVE` election ahead of schedule with explicit confirmation. Immediately halts new ballots (HTTP 409) while permanently preserving all cast votes and on-chain records.
- **Safe Election Deletion**:
  - **Unvoted Elections (0 votes)**: Can be safely deleted with cascading cleanup.
  - **Voted Elections (>0 votes)**: Deletion is strictly blocked (HTTP 400) to protect the cryptographic audit trail and immutable Ethereum Sepolia commitments. Administrators must use "Close Election Now" instead.

---

## Security boundaries and prototype limitations

1. Email verification establishes control of an email address, not a person's real-world identity or eligibility beyond the configured roster.
2. Ballot encryption and validity proofs are intended to protect the selected candidate in normal operation. Server operators, database access, implementation defects, timing/correlation metadata, and compromised voter devices remain in the threat model. The database schema includes optional relations between vote and voter records, so this prototype must not be described as providing unconditional anonymity.
3. An offline ballot remains pending in the browser until synchronized and accepted by the server. Availability, local storage, and connectivity can affect whether it is counted.
4. Merkle and blockchain records provide tamper-evidence and verifiability, not proof that the software, election configuration, or uploaded roster was correct. Sepolia is a public testnet, not a production election ledger.
5. Trustee approval controls do not replace independent governance, secure key management, certified cryptographic review, or operational controls.
6. A receipt is not coercion-resistant and may reveal participation or other metadata.
7. VoteChain is not certified for government or other high-stakes elections. Do not use it for statutory, public, or safety-critical elections.

---

## License

This project is released for academic, research, and educational purposes.