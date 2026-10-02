# VoteChain Admin Management & Election Lifecycle Controls Report

**Project**: VoteChain — Privacy-Preserving Blockchain Electronic Voting System  
**Framework**: Next.js 16.3.6 (Turbopack, App Router)  
**Database**: Neon Serverless PostgreSQL (Prisma 6.12.0)  
**Blockchain**: Ethereum Sepolia (`VoteChainLedger.sol` at `0x7339F8B088A2835F26e158c9F96690395D80264D`)  
**Date**: October 2, 2026  

---

## Executive Summary

This feature report provides the complete documentation, technical architecture, and verification results for the **Admin Management & Election Controls** implementation in VoteChain.

All required capabilities—administrator credential management, multi-party authority trustee custody, early election closure, and audit-safe election deletion—have been implemented and verified. Existing cryptographic guarantees (Zero-Knowledge proofs, double-blind identity separation, AES-256-GCM encryption, Shamir 2-of-3 threshold tallying, and Ethereum Sepolia on-chain commitments) are strictly preserved.

---

## 1. Admin Login & Credential Information

### 1.1 Existing Admin Account & Configuration
- **Existing Admin Email**: `admin@votechain.local`
- **User Role**: `ADMIN`
- **Account Status**: `ACTIVE` (`emailVerified: true`)
- **Configuration Location**:
  - Defined in `prisma/seed.ts` (lines 7–19) and configured via environment variables `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
  - Initialized with Bcrypt password hashing using cost factor 12.
- **Login Endpoint**:
  - Web UI: Navigate to `/login`
  - API Handler: `POST /api/auth/login`
  - Authentication Mechanism: `bcrypt.compare(password, user.passwordHash)`
  - Session Security: Generates an HMAC-SHA256 signed `votechain_session` cookie (`HttpOnly`, `SameSite=Lax`, `Path=/`).
  - Landing Route: Admins are automatically routed to the System Console at `/` (enforced via `src/backend/auth/role-routing.ts`).

### 1.2 Secure Password Reset & Account Creation Procedure (CLI)
To prevent printing secrets to standard output or hardcoding credentials into source code, a standalone CLI utility has been provided: [`scripts/create-or-reset-admin.ts`](file:///c:/Users/Prakash/Desktop/VoteChain/scripts/create-or-reset-admin.ts).

#### Usage:
```powershell
# Reset password for existing administrator (or create a new admin account):
npx tsx --env-file=.env scripts/create-or-reset-admin.ts admin@votechain.local YourNewStrongPassword123!
```

#### Security Guarantees:
- **Zero Secret Exposure**: Passwords are never printed to terminal logs, written to files, or stored in plaintext.
- **Complexity Enforcement**: Rejects passwords under 12 characters.
- **Bcrypt Cost 12**: Hashes password using 12 salt rounds before database insertion or update.
- **Role & Verification**: Automatically assigns role `ADMIN`, status `ACTIVE`, and `emailVerified: true`.

---

## 2. Multi-Party Authority (Trustee) Management

In VoteChain's modern security architecture, election Data Encryption Keys (DEKs) are split across independent trustees using Shamir's Secret Sharing over Galois Field $\text{GF}(256)$. Final tallying and decryption strictly require a **2-of-3 threshold quorum**.

### 2.1 Backend Authority APIs
- **List Authorities**: `GET /api/admin/authorities`
  - Returns configured authorities with `authorityIndex` (1, 2, or 3), `name`, `email`, `status`, `createdAt`, and `canAddMore: boolean`.
  - Private keys and Shamir secret shares are **never** returned in API responses.
- **Create / Invite Authority**: `POST /api/admin/authorities`
  - Payload: `{ name, email, password }`
  - Enforces hard ceiling of **3 authorities maximum**. Attempts to create a 4th authority are rejected with HTTP 400.
  - Prevents duplicate accounts by checking email across all users.
  - Automatically assigns slot index (Slot 1, Slot 2, or Slot 3) based on creation order.
  - Records an append-only audit event: `AUTHORITY_CREATED`.
- **Remove Authority**: `DELETE /api/admin/authorities/[authorityId]`
  - Safely deletes an unassigned authority.
  - **Audit Protection**: If an authority has already submitted approval records or key shares for an election, deletion is strictly rejected (HTTP 400).

### 2.2 Strict Voter-Authority Role Isolation
To guarantee complete separation of powers:
1. **Voting Blocked**: `checkVoterElectionEligibility` in `src/backend/voting/eligibility.ts` strictly rejects any user whose role is not `VOTER`. An authority attempting to cast a ballot receives HTTP 403 (`NOT_VOTER`).
2. **Eligibility List Protection**: `importElectionEligibilityList` in `src/backend/voting/eligibility.ts` actively queries the database for authority accounts and blocks any CSV upload containing an authority's email address.
3. **Registration Guard**: `POST /api/admin/users` and `POST /api/admin/authorities` reject registering an existing authority as an eligible voter.

### 2.3 Existing Configured Authority Trustees
```
┌─────────────┬──────────────────────────┬──────────────────────┬─────────┐
│ Slot Index  │ Name                     │ Email                │ Status  │
├─────────────┼──────────────────────────┼──────────────────────┼─────────┤
│ Authority 1 │ Election Trustee A       │ authority@votechain.local  │ ACTIVE  │
│ Authority 2 │ Election Trustee B       │ authority2@votechain.local │ ACTIVE  │
│ Authority 3 │ Election Trustee C       │ authority3@votechain.local │ ACTIVE  │
└─────────────┴──────────────────────────┴──────────────────────┴─────────┘
```

---

## 3. Early Election Closure ("Close Election Now")

### 3.1 Overview & Behavior
Under standard operation, elections close automatically at their scheduled `endTime`. However, during classroom sessions or expedited demonstrations, administrators need the capability to safely close an election ahead of schedule.

### 3.2 Implementation Details
- **API Endpoints**:
  - Dedicated Action: `POST /api/admin/elections/[electionId]/close`
  - Lifecycle Transition: `POST /api/admin/elections/[electionId]/transition` with `{ action: "close_early" }` or `{ action: "close", early: true }`
- **Execution Flow**:
  1. Validates caller is `ADMIN` via `requireAdminApi()`.
  2. Verifies election status is currently `ACTIVE` (returns HTTP 409 if already closed or in draft).
  3. Transitions status from `ACTIVE` to `CLOSED`.
  4. Updates `endTime` to `now()` so the scheduled election window immediately reflects closure.
  5. **Immediate Voting Halt**: `POST /api/voter/elections/[electionId]/vote` checks `election.status !== "ACTIVE"`. Any subsequent ballot submissions immediately return HTTP 409 (`Voting is only available while an election is active`).
  6. **Data & Blockchain Preservation**: All cast ballots, receipts, participation records, micro-blockchain blocks, and Ethereum Sepolia commitments remain completely intact.
  7. **Permanent State**: Elections in `CLOSED` status can only transition forward to `RESULTS_PUBLISHED` upon threshold authority approval; they **cannot be reopened**.
  8. **Audit Log Event**: Creates an append-only audit event: `ELECTION_CLOSED_EARLY` recording administrator identity, timestamp, and preserved vote count.

### 3.3 User Interface & Confirmation Modal
- Accessible directly on the Admin Dashboard (`/`) and Election Manager (`/elections`).
- Renders an alert confirmation modal displaying:
  - Election Name and ID
  - Total votes currently cast
  - Warning that voting halts immediately and the election cannot be reopened.
  - "Yes, Close Election Now" action button.

---

## 4. Safe Election Deletion & Cryptographic Audit Invariant

### 4.1 Deletion Policy
- **Endpoint**: `DELETE /api/admin/elections/[electionId]`
- **Unvoted Elections (`votesCount === 0`)**:
  - Allowed. Cascading deletion purges candidates, eligible voter lists, approvals, and blocks inside an atomic database transaction.
  - Records an append-only audit log: `ELECTION_DELETED`.
  - Returns HTTP 200 with confirmation message.
- **Voted Elections (`votesCount > 0` or `participationsCount > 0`)**:
  - **Strictly Disallowed (HTTP 400)**:
    ```json
    {
      "error": "Cannot delete election with cast votes. To preserve the cryptographic audit trail and blockchain commitments, close the election instead."
    }
    ```
  - **Rationale**: Once a vote is cast, commitments are permanently mined into the Ethereum Sepolia blockchain (`VoteChainLedger.sol`) and internal micro-blockchain ledger. Deleting a voted election from the database would break individual receipt verification (`/verify`), orphan on-chain commitments, and compromise cryptographic auditability. The UI guides administrators to use **Close Election Now** instead.

### 4.2 Confirmation Dialog
- Displays election name, ID, and vote count.
- For unvoted elections, requires the administrator to explicitly type **`DELETE`** into a verification input before the deletion button activates.

---

## 5. Admin Dashboard UI Organization

The Admin Dashboard has been reorganized into clean, intuitive sections matching the VoteChain design theme:

1. **Sidebar Navigation**:
   - **Overview**: System console, live metrics, focus election, audit activities, and election quick controls.
   - **Authorities**: Dedicated 2-of-3 threshold trustee management console.
   - **Elections**: Direct link to the complete Election Register (`/elections`).
   - **Voters**: Voter Registration Register and account enrollment.
   - **Ledger**: Direct link to the public blockchain ledger (`/results`).
   - **Audit trail**: Cryptographic append-only audit log (`/audit`).
2. **Authorities Section**:
   - Status banner indicating whether the 2-of-3 threshold is satisfied.
   - 3 distinct Authority Slot Cards (Slot 1, Slot 2, Slot 3) displaying assigned name, email, status, and Shamir key share position.
   - "Add Authority Trustee" action button and enrollment modal (disabled when all 3 slots are occupied).
3. **Elections Quick Control**:
   - Lists elections with real-time status pills (`ACTIVE`, `CLOSED`, `DRAFT`, `UPCOMING`, `RESULTS_PUBLISHED`).
   - Candidate count and live vote counters.
   - Contextual actions: "Close Election Now" (for active elections) and "Delete" (for unvoted elections).
   - "Protected (N votes)" badge for elections with cast votes.

---

## 6. Security & Role-Based Access Control (RBAC)

All new administrative endpoints enforce strict multi-tier defenses:
- **Authentication Check**: Missing or invalid session tokens return HTTP 401 (`Sign in required`).
- **Role Enforcement**: Requests from non-admin accounts (`VOTER`, `OBSERVER`, `AUTHORITY`) return HTTP 403 (`Administrator access required`).
- **CSRF & Origin Verification**: Same-origin referrer and Origin header validation on all mutation requests.
- **Input Validation**: Server-side bounds checking on all payloads (names: 2–80 chars, emails: valid domain and format, passwords: min 8/12 chars).

---

## 7. Automated Test Suite & Production Build Verification

### 7.1 Unit & Cryptographic Test Results
A new test suite [`tests/unit/admin-management.test.ts`](file:///c:/Users/Prakash/Desktop/VoteChain/tests/unit/admin-management.test.ts) was created and verified:

```
✔ Admin Authentication & Role Routing: maps ADMIN role to root dashboard route '/' (2.21ms)
✔ Admin Password Hashing: verifies bcrypt cost factor 12 and secure hash comparison (1918.67ms)
✔ Authority Slot Management: tracks authority slot index 1, 2, 3 and enforces maximum of 3 (0.56ms)
✔ Authority Role Isolation: voter eligibility check strictly rejects non-voter roles (0.17ms)
✔ Early Election Closure: halts voting immediately when election is CLOSED (0.45ms)
✔ Early Election Closure: preserves cast votes and does not permit reopening (0.21ms)
✔ Safe Election Deletion: allowed for 0-vote elections, restricted for voted elections (0.54ms)
✔ Threshold Security: 2-of-3 threshold requires 2 distinct authority approvals (1.14ms)

ℹ tests 8, pass 8, fail 0
```

### 7.2 Smart Contract Automated Test Results
```powershell
npm run test:contracts
```
```
▶ VoteChainLedger smart contract automated test suite
  ✔ registers an election with config hash on-chain (303.85ms)
  ✔ records a unique vote commitment on-chain (310.77ms)
  ✔ rejects duplicate vote commitment (one-person-one-vote / replay prevention) (116.28ms)
  ✔ records a second distinct vote commitment (203.47ms)
  ✔ finalizes election with Merkle root and results digest (282.99ms)
✔ VoteChainLedger smart contract automated test suite (2552.25ms)

ℹ tests 6, pass 6, fail 0
```

### 7.3 Next.js 16 Production Build
```powershell
npm run build
```
```
▲ Next.js 16.3.6 (Turbopack)
✓ Running next.config.ts took 1301ms
  Creating an optimized production build ...
✓ Compiled successfully in 30.7s
  Running TypeScript ...
  Finished TypeScript in 13.4s ...
✓ Generating static pages using 11 workers (21/21) in 816ms

Route (app)
┌ ƒ /
├ ƒ /_not-found
├ ƒ /api/admin/authorities
├ ƒ /api/admin/authorities/[authorityId]
├ ƒ /api/admin/elections
├ ƒ /api/admin/elections/[electionId]
├ ƒ /api/admin/elections/[electionId]/close
├ ƒ /api/admin/elections/[electionId]/transition
├ ƒ /api/admin/users
├ ƒ /authority
├ ƒ /elections
├ ƒ /portal
├ ƒ /results
└ ƒ /verify
```

---

## 8. Summary Table of Endpoints

| Endpoint | Method | Role Required | Description |
| :--- | :--- | :--- | :--- |
| `/api/admin/authorities` | `GET` | `ADMIN` | Returns list of 3 authority trustees with slot index (1, 2, 3). |
| `/api/admin/authorities` | `POST` | `ADMIN` | Invites/creates authority trustee (capped at 3 maximum). |
| `/api/admin/authorities/[authorityId]` | `DELETE` | `ADMIN` | Removes unassigned authority trustee. |
| `/api/admin/elections/[electionId]` | `GET` | `ADMIN` | Retrieves election details, candidates, and vote counts. |
| `/api/admin/elections/[electionId]` | `DELETE` | `ADMIN` | Safely deletes 0-vote election (rejects voted elections). |
| `/api/admin/elections/[electionId]/close` | `POST` | `ADMIN` | Immediately closes active election ahead of schedule. |
| `/api/admin/elections/[electionId]/transition` | `POST` | `ADMIN` | Advances election lifecycle (supports early close). |
