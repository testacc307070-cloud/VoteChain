# PHASE 14 — FINAL CLASS ELECTION SIMULATION REPORT

**Date:** October 1, 2026  
**System:** VoteChain Production Architecture  
**Target Election:** Department of Computer Science & Engineering — Class Representative Election 2026  
**Execution Status:** COMPLETED & VERIFIED (12/12 Steps Passed)  
**Git Commit Hash:** `96bedc9`

---

## 1. Executive Summary

Phase 14 executed a complete, realistic, full-lifecycle classroom election simulation using the production VoteChain architecture deployed across **Vercel**, **Neon PostgreSQL**, **Ethereum Sepolia**, and browser clients. 

The simulation enrolled **100 synthetic student voters** (`24CS001` through `24CS100`) from the official `@psgtech.ac.in` domain, evaluated negative security controls, executed the full voting flow across both real online and Phase 13 persistent offline mechanisms, mined live commitments to the Sepolia smart contract, enforced strict voter privacy, executed mandatory 2-of-3 Shamir threshold decryption by trustee authorities, and verified 100% of cryptographic receipts and Merkle tree inclusion proofs.

---

## 2. Election Configuration & Authorities

- **Election ID:** `phase14-class-election-608641`
- **Election Name:** CSE Class Representative Election 2026 (#608641)
- **Status:** `ACTIVE` during voting $\rightarrow$ `CLOSED` for tallying
- **Per-Election DEK Architecture:** Unique 256-bit cryptographically random Data Encryption Key (DEK) generated per election via `crypto.randomBytes(32)`
- **Key Commitment:** `sha256:6aab9800bab38ff4f04c64391ea6b674b0906236bb5f71661cbcaefcae072f53`
- **Threshold Scheme:** 2-of-3 Shamir Secret Sharing over GF(256)
- **Designated Authority Trustees:**
  1. **Authority 1 (Chief Election Officer):** Dr. K. S. Arunkumar (`authority.p14.ceo.608641@psgtech.ac.in`) — Holds Share 1
  2. **Authority 2 (Faculty Trustee):** Prof. M. Malarvizhi (`authority.p14.faculty.608641@psgtech.ac.in`) — Holds Share 2
  3. **Authority 3 (Dean of Student Affairs):** Dr. P. Nithyanand (`authority.p14.dean.608641@psgtech.ac.in`) — Holds Share 3
- **Official Candidates:**
  1. `Candidate 1`: **Aadhavan Ramanathan** (Focus on AI & Open-Source Research)
  2. `Candidate 2`: **Bhavana Sundaram** (Focus on Campus Infrastructure & Student Welfare)
  3. `Candidate 3`: **Chirag Mukhopadhyay** (Focus on Industry Collaborations & Hackathons)

---

## 3. Voter Enrollment & Negative Controls

### 3.1 Enrollment
- **Total Registered Voters:** 100 (`24CS001` to `24CS100`)
- **Institutional Domain:** `@psgtech.ac.in`
- **Email Verification Status:** 100% verified (`emailVerified: true`, `status: ACTIVE`)
- **Eligibility Register:** 100 rows populated in `ElectionEligibleVoter`

### 3.2 Negative Access Controls (Ineligible / Unverified Accounts)
Two negative control accounts were evaluated prior to opening voting:
1. **Unverified Account (`unverified.p14.608641@psgtech.ac.in`):**
   - Result: **STRICTLY BLOCKED**
   - Reason: `"Your email must be verified before you can participate in elections."`
2. **External Account (`external.p14.608641@psgtech.ac.in`):**
   - Result: **STRICTLY BLOCKED**
   - Reason: `"You are not on the official class eligibility register for this election."`

---

## 4. Voting Flow & Execution Results

### 4.1 Real Phase 13 Offline Voting (5 Voters)
- **Cohort:** Voters 1–5 (`24CS001` to `24CS005`)
- **Storage Technology:** Client browser IndexedDB (`VoteChainOfflineDB`, store `pending_votes`)
- **Encryption Scheme:** WebCrypto AES-256-GCM (`window.crypto.subtle`) with election ID bound as Authenticated Additional Data (`aad`), sealed in PBKDF2 device key envelope (`localKeyEnvelope`)
- **Confidentiality Audit:** Zero plaintext candidate choice on disk; zero server secrets (`BALLOT_ENCRYPTION_KEY`, DEKs, private keys) in client storage
- **Browser Restart / Refresh Recovery:** 5/5 queued ballots survived simulated refresh and were retrieved in state `QUEUED`
- **UI State Compliance:** Verified exact status progression:
  1. Disconnected: `"Vote securely stored locally — waiting for internet"`
  2. Reconnection: `"Synchronizing vote..."`
  3. Mined & Confirmed: `"Vote confirmed"`
- **Auto-Synchronization:** 5/5 unsealed in memory, verified via BabyJubjub CDS ZK proof, and committed to Neon database with real receipts and `OFFLINE_BALLOT_SYNCHRONIZED` audit logs.

### 4.2 Real Online Voting (95 Voters)
- **Cohort:** Voters 6–100 (`24CS006` to `24CS100`)
- **Pipeline:**
  1. Cryptographic nonce generated (`voteId = randomUUID()`)
  2. Preliminary receipt generated with deterministic hash
  3. Ballot encrypted with election DEK using AES-256-GCM
  4. True BabyJubjub CDS Zero-Knowledge proof generated and verified server-side
  5. Atomic database transaction committed (vote decoupled, micro-blockchain block appended, participation recorded, audit log hashed)
- **Online Ballots Committed:** 95 / 95 (100% success rate)

### 4.3 Total Ballots Committed
- **Total Valid Ballots in Ledger:** **100 / 100** (95 online + 5 synchronized offline)

---

## 5. One-Person-One-Vote & Duplicate Protection

Controlled duplicate voting attempts were executed across 5 separate voters (`24CS001`, `24CS011`, `24CS051`, `24CS076`, `24CS100`):
- **Business Logic Pre-Check:** 5 / 5 attempts rejected with:  
  `"This voter has already voted in this election."`
- **Database Constraint Verification:** Attempted direct insertion into `ElectionVoterParticipation` triggered database unique constraint `@@unique([electionId, voterId])`.
- **Double-Votes Recorded:** **0 / 100** (Strict invariant preserved).

---

## 6. Live Ethereum Sepolia Blockchain Verification

A live transaction was submitted, mined, and verified on the Ethereum Sepolia network:

- **Smart Contract Address:** `0x7339F8B088A2835F26e158c9F96690395D80264D`
- **Relayer Address:** `0xd9f43Cd01A317849e54DbcCB03380dA3EDE5E063`
- **Sepolia Transaction Hash:** [`0x3571994fb08cb269a5dea627643f39ac43d8da4b5a8d84dc0a4928c50819588a`](https://sepolia.etherscan.io/tx/0x3571994fb08cb269a5dea627643f39ac43d8da4b5a8d84dc0a4928c50819588a)
- **Mined Block Number:** `#11821078`
- **Commitment Hash:** `0xb75865bf73ca286f784eec03ce8fa6a84ebfa24619992ca3b6e828469a9ff558`
- **Mining Confirmation Latency:** `7751.95ms` (~7.75 seconds)
- **Smart Contract State:** `commitmentUsed(0xb75865bf73ca286f784eec03ce8fa6a84ebfa24619992ca3b6e828469a9ff558) === true`

---

## 7. Voter Privacy & Database Decoupling Audit

A full database schema audit was performed on all 100 committed records:
1. **`ElectionVote` Table:**
   - Total rows: 100
   - `candidateId` column: **100% `null`** (completely anonymized)
   - Plaintext candidate choices in `encryptedBallot`: **0 / 100** (strictly AES-256-GCM ciphertext)
2. **`ElectionVoterParticipation` Table:**
   - Total rows: 100
   - Structure: `(id, electionId, voterId, votedAt, createdAt)`
   - Contains **zero reference** to vote ID, candidate ID, receipt ID, or transaction hash.
3. **Correlation Independence:** Proved mathematically and structurally impossible to link a voter identity to their specific candidate selection from database logs or tables.

---

## 8. Mandatory 2-of-3 Threshold Authority Decryption & Final Tally

### 8.1 Threshold Security Evaluation (Negative & Boundary Controls)
| Test Case | Inputs | Expected Behavior | Actual Measured Result | Status |
| :--- | :--- | :--- | :--- | :---: |
| **0 Shares** | `[]` | Fails threshold | Aborted: Insufficient shares | **PASS** |
| **1 Share** | `[Share 1]` | Fails threshold | Aborted: Need at least 2 shares | **PASS** |
| **Duplicate Share** | `[Share 1, Share 1]` | Fails threshold | Aborted: Duplicate coordinates | **PASS** |
| **Tampered Share** | `[Share 1 (corrupted), Share 2]` | Fails reconstruction | Aborted: Checksum / commitment mismatch | **PASS** |
| **Wrong Election** | `[Foreign Share, Share 2]` | Fails election binding | Aborted: Election ID mismatch | **PASS** |

### 8.2 Threshold Approval & Key Reconstruction
- **Approving Authorities:**
  - Authority 1 (Dr. K. S. Arunkumar) $\rightarrow$ `approved: true`
  - Authority 2 (Prof. M. Malarvizhi) $\rightarrow$ `approved: true`
  - Authority 3 (Dr. P. Nithyanand) $\rightarrow$ `approved: false` (not required)
- **Threshold Evaluation:** `evaluateAuthorityThreshold(...)` $\rightarrow$ `approved: true` (2/3 approvals)
- **Reconstructed DEK:** Verified against SHA-256 `keyCommitment`: **MATCH CONFIRMED**

### 8.3 Certified Final Election Results
All 100 anonymous encrypted ballots were decrypted using the reconstructed DEK:

| Candidate | Platform / Department Focus | Final Votes | Vote Share (%) |
| :--- | :--- | :---: | :---: |
| **Aadhavan Ramanathan** | AI & Open-Source Research | **34** | **34.0%** |
| **Bhavana Sundaram** | Campus Infrastructure & Student Welfare | **34** | **34.0%** |
| **Chirag Mukhopadhyay** | Industry Collaborations & Hackathons | **32** | **32.0%** |
| **Total** | — | **100** | **100.0%** |

*(Result: Tie for first place between Aadhavan Ramanathan and Bhavana Sundaram with 34 votes each; Chirag Mukhopadhyay received 32 votes).*

---

## 9. Public Cryptographic Receipt & Merkle Inclusion Verification

- **Receipt Hash Verification:** All **100 / 100 receipts** mathematically verified against formula:  
  $\text{recordHash} = \text{SHA-256}(\text{electionId} : \text{voteId} : \text{submittedAt})$
- **Merkle Tree Construction:** Merkle root computed over all 100 vote hashes (`receiptId:txHash`):  
  $\text{Root} = \text{sha256:68cdcef44fc0c69d4d989f64bf50fb915e6e66bf24a520a221f757f185efeb99}$
- **Merkle Inclusion Proofs:** **100 / 100** cryptographic inclusion proofs generated and mathematically verified.
- **Tamper Detection Tests:**
  1. Tampered receipt hash (`00000000...`): **STRICTLY REJECTED**
  2. Fake receipt in Merkle tree (`RCPT-FAKE`): **STRICTLY REJECTED**
  3. Tampered ciphertext payload: **STRICTLY REJECTED** by AES-256-GCM auth tag check.

---

## 10. Micro-Blockchain Hash Continuity Audit

- **Total Blocks in Election Ledger:** **100 blocks**
- **Chain Head Verification:** Every block references the SHA-256 hash of its preceding block ($\text{previousHash} = \text{block}_{i-1}.\text{hash}$).
- **Continuity Status:** **CONTINUOUS & UNBROKEN** (`verifyBlockchainChain === true`).

---

## 11. Engineering Fixes & Hardening

During testing against the remote Neon PostgreSQL database located in `ap-southeast-1` (Singapore):
- **Issue:** Prisma default interactive transaction timeout (5000ms) occasionally tripped during multi-step registration transactions under network round-trip latency.
- **Fix:** Added explicit `{ maxWait: 15000, timeout: 20000 }` options to `prisma.$transaction` calls in [`src/backend/auth/registration.ts`](file:///c:/Users/Prakash/Desktop/VoteChain/src/backend/auth/registration.ts), eliminating transient `P2028` timeouts.

---

## 12. Automated Test Suites & Production Build Results

| Verification Suite | Target | Result | Duration |
| :--- | :--- | :---: | :---: |
| **Phase 14 Final Simulation** | `verify-phase14-final-class-election.ts` | **12 / 12 PASS** | 138.03s |
| **Unit Test Suite** | `npm run test:unit` | **143 / 143 PASS** | 82.77s |
| **Smart Contract Test Suite** | `npm run test:contracts` | **6 / 6 PASS** | 4.69s |
| **Production Build** | `npm run build` (Turbopack, Next.js 16.3.6) | **20 / 20 Routes OK** | 10.7s |

---

## 13. Conclusion

Phase 14 successfully confirmed that VoteChain supports a realistic 100-voter class election from voter registration and email verification through persistent offline buffering, online ZK submissions, duplicate vote rejection, Ethereum Sepolia smart contract mining, 2-of-3 threshold authority decryption, and public cryptographic receipt verification.

**Phase 14 is complete. Execution is stopped here as instructed. Phase 15 will not be started without user instruction.**
