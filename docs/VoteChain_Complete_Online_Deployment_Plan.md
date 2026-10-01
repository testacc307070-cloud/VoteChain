# VoteChain — Complete Online Deployment Roadmap & Execution Record

> **Final Project Status:** **100% COMPLETE & VERIFIED** (Phases 1–15 Fully Implemented, Tested, Audited, and Certified).

---

## 1. Locked Architectural Decisions (Verified in Production)

- **Target Audience:** University students and classroom elections (~100 voters per election).
- **Public Website:** Deployed on **Vercel** (`Next.js 16.3.6`, React 19, Turbopack).
- **Voter Registration:** Self-registration for students with institutional PSG Tech credentials.
- **Allowed Institutional Email:** `@psgtech.ac.in` domain strictly enforced.
- **Email Verification Sender:** Automated Gmail SMTP (`votechain.verify@gmail.com`) delivering single-use 15-minute token links.
- **Eligibility Model:** Administrator uploads official class roster CSV per election (`ElectionEligibleVoter`).
- **One-Person-One-Vote:** Strict atomic database constraints and participation tracking (`ElectionVoterParticipation`).
- **Database:** **Neon PostgreSQL Serverless** with Prisma Client 6.12.0 and connection pooling.
- **Blockchain:** **Ethereum Sepolia Testnet** (Chain ID `11155111`).
- **Smart Contract:** [`VoteChainLedger.sol`](contracts/VoteChainLedger.sol) deployed at `0x7339F8B088A2835F26e158c9F96690395D80264D`.
- **Sponsored Relayer:** Server-side sponsored transactions via `0xd9f43Cd01A317849e54DbcCB03380dA3EDE5E063` (zero cryptocurrency or Web3 wallet burden on students).
- **Offline Voting:** Real client-side **IndexedDB** (`VoteChainOfflineDB`) persistent queueing with WebCrypto AES-256-GCM and automatic network recovery synchronization.
- **Threshold Scheme:** Mandatory 2-of-3 Shamir Secret Sharing over $\text{GF}(256)$ with per-election DEKs.
- **Zero-Knowledge Verification:** Cramer-Damgård-Schoenmakers (CDS) 1-of-$N$ disjunctive Schnorr NIZKP on BabyJubjub curve via Poseidon hash.

---

## 2. Production Topology & Cloud Stack

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        STUDENT / VOTER BROWSER                         │
│  React 19 UI  •  BabyJubjub CDS ZK Prover  •  IndexedDB Offline Queue  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS (TLS 1.3)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      VERCEL PRODUCTION DEPLOYMENT                      │
│        Next.js 16 (Turbopack) • App Router • Security Headers          │
│               CSRF Same-Origin Validation • Role Guards                │
└───────────────────────┬──────────────────────────┬─────────────────────┘
                        │                          │
           SQL over TLS │ (Port 5432)              │ JSON-RPC (Sepolia)
                        ▼                          ▼
┌────────────────────────────────┐       ┌────────────────────────────────┐
│   NEON POSTGRESQL SERVERLESS   │       │   ETHEREUM SEPOLIA TESTNET     │
│   • Users & Single-Use Tokens  │       │   Contract: 0x7339F8B088A...   │
│   • ElectionEligibleVoter Reg. │       │   • recordVote(elecId, commit) │
│   • Decoupled Participation    │       │   • finalizeElection(...)      │
│   • Anonymous ElectionVote     │       │   • commitmentUsed[commit] map │
│   • Micro-Blockchain Blocks    │       │   Relayer: 0xd9f43Cd01A3...    │
└────────────────────────────────┘       └────────────────────────────────┘
```

---

## 3. Phase-by-Phase Roadmap Execution Record

| Phase | Phase Objective | Key Deliverables & Implemented Architecture | Status |
| :---: | :--- | :--- | :---: |
| **Phase 1** | Institutional Registration & Email Verification | `@psgtech.ac.in` domain enforcement, Gmail SMTP delivery (`votechain.verify@gmail.com`), SHA-256 hashed single-use tokens with 15m expiration. | **VERIFIED** |
| **Phase 2** | Per-Election Class Eligibility Lists | CSV roster import, deduplication, row-limit checks, `ElectionEligibleVoter` table, election-specific whitelists. | **VERIFIED** |
| **Phase 3** | One-Person-One-Vote Strict Enforcement | Atomic database constraints (`@@unique([electionId, voterId])`), duplicate vote rejection (HTTP 409), HMAC-SHA256 session token cookies. | **VERIFIED** |
| **Phase 4** | Neon PostgreSQL Cloud Database Migration | Serverless PostgreSQL migration, pooled connections, cloud schema migrations via Prisma. | **VERIFIED** |
| **Phase 5** | Production Vercel Deployment & URL Realignment | Next.js 16 Turbopack deployment, dynamic base URL resolution for verification emails, production security headers. | **VERIFIED** |
| **Phase 6** | Production Security Hardening & Zero-Leakage Audit | Verified zero `NEXT_PUBLIC_` secret leakage, CSRF SameSite origin guards, HSTS, frame denial (`DENY`), nosniff headers. | **VERIFIED** |
| **Phase 7** | Ethereum Sepolia Testnet Migration | Deployed `VoteChainLedger.sol` to Sepolia at `0x7339F8B088A2835F26e158c9F96690395D80264D`, funded relayer wallet `0xd9f43Cd01A317849e54DbcCB03380dA3EDE5E063`. | **VERIFIED** |
| **Phase 8** | Live Browser End-to-End Online Voting | Complete live browser voting flow, real Sepolia transaction mining, cryptographic receipt verification, tampered receipt rejection. | **VERIFIED** |
| **Phase 9.1**| Per-Election Cryptographic Key Architecture | Unique 256-bit random Data Encryption Key (DEK) per election + SHA-256 `keyCommitment`. | **VERIFIED** |
| **Phase 9.2**| True 2-of-3 Threshold Authority Key Custody | Shamir Secret Sharing over $\text{GF}(256)$ ($0x11b$ polynomial), designated trustee accounts, key share custody. | **VERIFIED** |
| **Phase 9.3**| Mandatory Threshold Decryption for Tallying | Legacy global-key fallback strictly eliminated for modern elections; results require at least 2 distinct valid authority shares matching commitment. | **VERIFIED** |
| **Phase 10**| Full Online Stack End-to-End Integration | Complete pipeline verified: Vercel $\rightarrow$ Neon $\rightarrow$ Browser $\rightarrow$ ZK Proof $\rightarrow$ Sepolia $\rightarrow$ 2-of-3 Authority Tally $\rightarrow$ Public Verification. | **VERIFIED** |
| **Phase 11**| Security Audit & Hardening | 29 automated penetration and security tests: IDOR, SQL/NoSQL injection, replay attacks, tampered ZK proofs, secret leakage, timing attacks. | **VERIFIED** |
| **Phase 12**| Capacity & Load Testing (~100 Classroom Users) | 100 concurrent user simulation, race condition testing, Neon connection pool behavior, throughput and latency benchmarking. | **VERIFIED** |
| **Phase 13**| Real Persistent Offline Voting & Auto-Sync | Client-side IndexedDB queue (`VoteChainOfflineDB`), WebCrypto AES-256-GCM local encryption, PBKDF2 envelope, auto-sync upon `online` event, real Sepolia mining. | **VERIFIED** |
| **Phase 14**| Final Realistic Class Election Simulation | 100 classroom voters, 95 online + 5 offline sync, Sepolia block `#11821078`, 2-of-3 authority tally, Merkle verification, 12/12 steps passed. | **VERIFIED** |
| **Phase 15**| Final System Audit, Documentation & Organization | Complete architectural audit, comprehensive documentation update, repository organization, teacher-friendly Key Files guide, test certification. | **VERIFIED** |

---

## 4. Definition of Done: All Criteria Satisfied

- [x] **Public website accessible online** (Vercel)
- [x] **Student self-registration with `@psgtech.ac.in` validation**
- [x] **Real email verification via Gmail SMTP**
- [x] **Per-election eligibility roster import & checking**
- [x] **Strict role-based access control** (Admin, Voter, Authority, Observer)
- [x] **BabyJubjub CDS 1-of-$N$ Zero-Knowledge proof generation & verification**
- [x] **AES-256-GCM ballot encryption with per-election DEKs**
- [x] **Double-blind database separation** (zero link between voter and candidate selection)
- [x] **Real Ethereum Sepolia blockchain transaction mining**
- [x] **Immutable cryptographic receipts issued to voters**
- [x] **Duplicate vote blocking & replay protection** (one-person-one-vote)
- [x] **Mandatory 2-of-3 Shamir threshold authority decryption**
- [x] **Balanced SHA-256 Merkle tree universal inclusion verification**
- [x] **Real persistent offline voting via IndexedDB and automatic synchronization**
- [x] **Zero exposed secrets, private keys, or passwords in client bundle or Git**
- [x] **100% passing test suites** (143 unit/security tests, 6 contract tests, 9 offline tests, 12 simulation steps)
- [x] **Clean production build with zero type errors** (Next.js 16 Turbopack)

---

## 5. Prototype Scope & Limitations

VoteChain is designed and documented as an **educational and research prototype**:
1. It is designed for classroom and campus elections (~100 voters).
2. It is **not** certified for official governmental or national public elections.
3. It proves control of an institutional `@psgtech.ac.in` email account via single-use tokens; it does not replace in-person physical or biometric identity verification.
4. Client-side security assumes uncompromised user endpoints.
5. All code and test harnesses are retained in the repository for academic demonstration and evaluation.
