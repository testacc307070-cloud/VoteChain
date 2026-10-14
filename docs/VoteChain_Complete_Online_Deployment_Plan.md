# VoteChain — Online Deployment Roadmap & Record

> **Scope:** Deployment record and operational guidance for VoteChain's educational prototype. Historical phase/test records are not a security certification, current test result, or assurance for a government election.

---

## 1. Deployment architecture

- **Target Audience:** University students and classroom elections (~100 voters per election).
- **Web Application:** Deployed on **Vercel** (`Next.js 16`, React 19).
- **Voter Registration:** Self-registration for students with institutional PSG Tech credentials.
- **Allowed Institutional Email:** `@psgtech.ac.in` domain strictly enforced.
- **Email Delivery:** Nodemailer using SMTP settings provided as environment variables.
- **Eligibility Model:** Administrator uploads official class roster CSV per election (`ElectionEligibleVoter`).
- **One-Person-One-Vote:** Strict atomic database constraints and participation tracking (`ElectionVoterParticipation`).
- **Database:** **Neon PostgreSQL Serverless** with Prisma Client 6.12.0 and connection pooling.
- **Blockchain:** **Ethereum Sepolia testnet** (Chain ID `11155111`) and the `VoteChainLedger.sol` contract, configured via server-side environment variables.
- **Transaction Sender:** Server-side RPC/relayer configuration; individual voter wallets are not required.
- **Offline Voting:** Real client-side **IndexedDB** (`VoteChainOfflineDB`) persistent queueing with WebCrypto AES-256-GCM and automatic network recovery synchronization.
- **Threshold Scheme:** Mandatory 2-of-3 Shamir Secret Sharing over $\text{GF}(256)$ with per-election DEKs.
- **Zero-Knowledge Verification:** CDS 1-of-$N$ disjunctive Schnorr proof implementation using BabyJubjub and Poseidon through `circomlibjs`.
- **Receipts and observers:** Voters can download PDF receipts; observers can use election-scoped access codes or the signed-in dashboard. Candidate totals are official in the application only after results are published.
- **Prototype boundary:** This is an educational system, not a certified public-election service. Sepolia is a test network.

---

## 2. Hosted prototype topology & cloud stack

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        STUDENT / VOTER BROWSER                         │
│  React 19 UI  •  BabyJubjub CDS ZK Prover  •  IndexedDB Offline Queue  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS (TLS 1.3)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       VERCEL APPLICATION HOST                           │
│        Next.js 16 (Turbopack) • App Router • Security Headers          │
│               CSRF Same-Origin Validation • Role Guards                │
└───────────────────────┬──────────────────────────┬─────────────────────┘
                        │                          │
           SQL over TLS │ (Port 5432)              │ JSON-RPC (Sepolia)
                        ▼                          ▼
┌────────────────────────────────┐       ┌────────────────────────────────┐
│   NEON POSTGRESQL SERVERLESS   │       │   ETHEREUM SEPOLIA TESTNET     │
│   • Users & Single-Use Tokens  │       │   Vote commitments            │
│   • ElectionEligibleVoter Reg. │       │   • recordVote(elecId, commit) │
│   • Participation & votes      │       │   • finalizeElection(...)      │
│   • Trustee approvals & audit  │       │   • commitmentUsed[commit] map │
│   • Micro-Blockchain Blocks    │       │   Server-side RPC/relayer      │
└────────────────────────────────┘       └────────────────────────────────┘
```

---

## 3. Historical Phase Execution Record

Statuses and test figures in this matrix describe earlier project work; they were not independently rerun for this update.

| Phase | Phase Objective | Key Deliverables & Implemented Architecture | Status |
| :---: | :--- | :--- | :---: |
| **Phase 1** | Institutional Registration & Email Verification | `@psgtech.ac.in` validation, configured SMTP delivery, single-use email verification tokens. | Historical record |
| **Phase 2** | Per-Election Class Eligibility Lists | CSV roster import, deduplication, row-limit checks, `ElectionEligibleVoter` table, election-specific whitelists. | **VERIFIED** |
| **Phase 3** | One-Person-One-Vote Strict Enforcement | Atomic database constraints (`@@unique([electionId, voterId])`), duplicate vote rejection (HTTP 409), HMAC-SHA256 session token cookies. | **VERIFIED** |
| **Phase 4** | Neon PostgreSQL Cloud Database Migration | Serverless PostgreSQL migration, pooled connections, cloud schema migrations via Prisma. | **VERIFIED** |
| **Phase 5** | Vercel Deployment & URL Resolution | Next.js deployment, security headers, base URL resolution through `NEXT_PUBLIC_APP_URL` and Vercel-provided URL variables. | Historical record |
| **Phase 6** | Security Hardening | CSRF origin checks, security headers, and role guards. Historical report, not a current independent audit. | Historical record |
| **Phase 7** | Ethereum Sepolia Testnet Integration | `VoteChainLedger.sol` integration with server-side RPC/relayer configuration. | Historical record |
| **Phase 8** | Live Browser End-to-End Online Voting | Complete live browser voting flow, real Sepolia transaction mining, cryptographic receipt verification, tampered receipt rejection. | **VERIFIED** |
| **Phase 9.1**| Per-Election Cryptographic Key Architecture | Unique 256-bit random Data Encryption Key (DEK) per election + SHA-256 `keyCommitment`. | **VERIFIED** |
| **Phase 9.2**| True 2-of-3 Threshold Authority Key Custody | Shamir Secret Sharing over $\text{GF}(256)$ ($0x11b$ polynomial), designated trustee accounts, key share custody. | **VERIFIED** |
| **Phase 9.3**| Threshold Tally Authorization | Modern elections require the configured distinct authority shares; legacy elections retain a compatibility path. | Historical record |
| **Phase 10**| Full Online Stack End-to-End Integration | Complete pipeline verified: Vercel $\rightarrow$ Neon $\rightarrow$ Browser $\rightarrow$ ZK Proof $\rightarrow$ Sepolia $\rightarrow$ 2-of-3 Authority Tally $\rightarrow$ Public Verification. | **VERIFIED** |
| **Phase 11**| Security Audit & Hardening | 29 automated penetration and security tests: IDOR, SQL/NoSQL injection, replay attacks, tampered ZK proofs, secret leakage, timing attacks. | **VERIFIED** |
| **Phase 12**| Capacity & Load Testing (~100 Classroom Users) | 100 concurrent user simulation, race condition testing, Neon connection pool behavior, throughput and latency benchmarking. | **VERIFIED** |
| **Phase 13**| Offline Queue & Synchronization | Encrypted IndexedDB queue; a queued ballot is pending until server acceptance after reconnection. | Historical record |
| **Phase 14**| Classroom Election Simulation | Simulation documented in the phase report; treat its figures as historical test data, not a present certification. | Historical record |
| **Phase 15**| Documentation & Organization | Architectural guides and Key Files guide; subsequent implementation also adds published results, PDF receipts, observer workflows, tied-result handling, and consistent IST display/scheduling. | Historical record |

---

## 4. Implemented feature areas (not certification criteria)

- [x] **Public website accessible online** (Vercel)
- [x] **Student self-registration with `@psgtech.ac.in` validation**
- [x] **Email verification through configured SMTP**
- [x] **Per-election eligibility roster import & checking**
- [x] **Strict role-based access control** (Admin, Voter, Authority, Observer)
- [x] **BabyJubjub CDS 1-of-$N$ Zero-Knowledge proof generation & verification**
- [x] **AES-256-GCM ballot encryption with per-election DEKs**
- [x] **Ballot privacy mechanisms** (encrypted ballot payloads and candidate-validity proofs; the schema includes optional voter relations and does not guarantee unconditional anonymity)
- [x] **Real Ethereum Sepolia blockchain transaction mining**
- [x] **Immutable cryptographic receipts issued to voters**
- [x] **Duplicate vote blocking & replay protection** (one-person-one-vote)
- [x] **2-of-3 trustee approval/share threshold** for modern-election tally authorization
- [x] **Balanced SHA-256 Merkle tree universal inclusion verification**
- [x] **Encrypted IndexedDB offline queue and synchronization** (queued ballots still require server acceptance)
- [x] **PDF vote receipts, observer access codes/dashboard, and published-results view**
- [x] **Tie outcome handling** (a shared highest tally produces no unique winner)
- [x] **IST scheduling/display** with UTC timestamp persistence

Prior test results and audit documents remain available as historical records. Do not interpret this checklist as a current build, security certification, or claim that no secrets exist anywhere in repository history.

---

## 5. Operational workflow

1. The administrator creates an election, enters its schedule in IST, adds candidates, uploads the eligible-voter CSV, assigns trustees, configures observer access, then activates the election. Date/time values are stored as UTC instants.
2. Voters register and verify email, pass the election roster check, and submit a ballot. Offline ballots stay encrypted in IndexedDB and count only after synchronization and server acceptance.
3. Accepted votes receive transaction-backed receipts; voters can verify a receipt and download its PDF.
4. The administrator invites authority users. Invitees activate their accounts from the invitation link; the administrator assigns authorities to the election.
5. After closing, distinct authority approvals/shares authorize tallying. The administrator then publishes official results; closure by itself does not publish candidate totals. A tie for the highest count is displayed as “No Result,” without declaring a unique winner.
6. Observers monitor through election-scoped access at `/observe` or the authenticated observer dashboard at `/observer`.

## 6. Environment and deployment procedure

Prerequisites are Node.js 20.9+, npm, PostgreSQL, and (for ledger actions) a Sepolia RPC endpoint and configured `VoteChainLedger` address. Email workflows also require SMTP settings.

Configure these environment variable **names** in local `.env` or Vercel project settings; never commit their values:

- Database/session/ballot keys: `DATABASE_URL`, `SESSION_SECRET`, `BALLOT_ENCRYPTION_KEY`, optional `KEY_ENCRYPTION_KEY`.
- Application URL: optional `NEXT_PUBLIC_APP_URL`; Vercel manages `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL`.
- SMTP: `EMAIL_USER`, `EMAIL_APP_PASSWORD`, optional `ADMIN_EMAIL_USER`, `ADMIN_EMAIL_APP_PASSWORD`.
- Blockchain: `ETHEREUM_RPC_URL`, `VOTECHAIN_CONTRACT_ADDRESS`, and where applicable `ETHEREUM_PRIVATE_KEY` or `ETHEREUM_ACCOUNT`.
- Local-only seed/policy configuration: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, optional role seed variables, and optional `MIN_PASSWORD_LENGTH`.

For local development, install with `npm ci`, generate Prisma Client with `npx prisma generate`, apply checked-in migrations using `npm run db:migrate`, and run `npm run dev`. `npm run db:seed` is optional and should only be used against a development database with privately configured seed credentials.

The Vercel Git integration uses the repository's production branch (`master`). Configure production values in the linked Vercel project, ensure they point to the intended Neon database and Sepolia contract, and let Vercel deploy commits from that branch. Apply schema changes only through reviewed Prisma migrations with `npm run db:migrate`; do not reset data or use `db push` as a substitute for production migrations. Documentation-only changes need no database migration.

## 7. Prototype Scope & Limitations

VoteChain is designed and documented as an **educational and research prototype**:
1. It is designed for classroom and campus elections (~100 voters).
2. It is **not** certified for official governmental or national public elections.
3. It proves control of an institutional `@psgtech.ac.in` email account via single-use tokens; it does not replace in-person physical or biometric identity verification.
4. Client-side security assumes uncompromised user endpoints; voter devices, server operators, and database access remain in the trust model.
5. All code and test harnesses are retained in the repository for academic demonstration and evaluation.
6. Merkle and testnet evidence cannot establish that the software, election configuration, or source voter roster was correct; receipts do not provide coercion resistance.
