# VoteChain — Authority Invitation, Email Configuration, Password Recovery, Threshold Architecture & Observer Access Code Plan

**Document**: Implementation & Architecture Plan (Updated with Review Corrections)  
**Target Repository**: VoteChain (`master` branch)  
**Status**: PLANNING ONLY — AWAITING REVIEW & APPROVAL  
**Author**: Antigravity AI Assistant & Engineering Team  
**Date**: October 2, 2026  

---

## Executive Summary

This document presents a comprehensive, production-grade implementation plan addressing administrative provisioning, transactional email infrastructure, cryptographic trustee management, universal password recovery, and election observation for the VoteChain platform.

Following the initial architectural review, this plan has been updated to incorporate the following critical directives:
1. **Interactive Hidden-Prompt Admin Provisioning**: Eliminating command-line password arguments entirely; designing a CLI tool that uses hidden/masked input with mandatory confirmation so passwords never appear in shell history, process tables, logs, or source code.
2. **Strict Raw Token Protection Rules**: Ensuring 256-bit CSPRNG invitation and reset tokens are hashed at rest, never logged anywhere (logs, audit, errors), immediately stripped from browser URLs upon arrival, never stored in client storage (`localStorage`/`sessionStorage`/cookies), and immediately burned upon redemption.
3. **Repository-Aligned Database Migration Strategy**: Rejecting blind `prisma db push` prescriptions; explicitly establishing a protocol to inspect existing migration history (`prisma/migrations`) and employ the safest production-compatible approach (`prisma migrate deploy` / auditable migration scripts) on Neon PostgreSQL.
4. **Strict 2-of-3 Threshold Architecture**: Formalizing the **Global Authority Pool + Election-Specific Trustee Assignment** model with an unbounded authority pool, exact selection of 3 trustees mapped to Slots 1, 2, and 3 ($x = 1, 2, 3$), strict 2-of-3 threshold enforcement, total exclusion of unassigned authorities from key shares, immutable slot locking upon election publication, and historical fallback.
5. **Election-Specific Observer Access Code System**: Establishing a dedicated, accountless observation system where observers authenticate using election-scoped access codes stored solely as cryptographic hashes, preventing observer account clutter while maintaining strict read-only auditing boundaries.
6. **Preserved Core Pillars**: Retaining dual-sender Gmail SMTP segregation (`votechain.verify@gmail.com` vs. `admin.votechain@gmail.com`), non-enumerating forgot-password flows, and centralized password complexity validation.

> **CRITICAL DIRECTIVE COMPLIANCE**: This document is **PLANNING ONLY**. No application source code, Prisma schema, production databases, environment variables, smart contracts, or live systems have been modified. Implementation will commence only after explicit user approval.

---

## 1. Current Architecture Findings

### 1.1 Existing Email Implementation
- **Mailer Location**: [`src/backend/auth/email.ts`](file:///c:/Users/Prakash/Desktop/VoteChain/src/backend/auth/email.ts)
- **Current Sender**: `votechain.verify@gmail.com` (hardcoded constant `VOTECHAIN_SENDER_EMAIL`).
- **Nodemailer Transport**:
  ```ts
  const user = (process.env.EMAIL_USER || process.env.test_mail || VOTECHAIN_SENDER_EMAIL).trim();
  const pass = (process.env.EMAIL_APP_PASSWORD || process.env.test_pass || "").trim();
  ```
- **Transporter Behavior**: Uses Gmail service transport (`service: "gmail"`). If `EMAIL_APP_PASSWORD` is absent, it logs a simulation warning and bypasses network dispatch without crashing.
- **Base URL Resolution**: Dynamically checks `NEXT_PUBLIC_APP_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL`, falling back to `http://localhost:3000`.
- **Existing Email Types**: Only student voter email verification (`sendVerificationEmail`). No password reset or invitation emails currently exist.

### 1.2 Verification Token Architecture
- **Token Model**: Prisma model `VerificationToken` in [`prisma/schema.prisma`](file:///c:/Users/Prakash/Desktop/VoteChain/prisma/schema.prisma):
  - `id`: String (cuid)
  - `userId`: String (foreign key to `User.id` with `onDelete: Cascade`)
  - `tokenHash`: String (unique SHA-256 digest of 32 random bytes)
  - `expiresAt`: DateTime (currently 24-hour expiration)
  - `usedAt`: DateTime? (null when pending, timestamp when redeemed)
- **Token Invariants**:
  - Raw tokens are sent only in URL query parameters (`/verify-email?token=<rawToken>`) and **never stored in plaintext in the database**.
  - Database stores only `SHA-256(rawToken)`.
  - Replay protection: If `usedAt !== null`, the request is rejected with `TOKEN_REUSED`.
  - Expiration protection: If `expiresAt < now()`, the request is rejected with `TOKEN_EXPIRED`.
- **Identified Deficiencies**:
  - `VerificationToken` currently lacks a `type` classifier; all tokens implicitly represent email verification.
  - The frontend does not currently strip query tokens from the browser address bar after page load, leaving tokens visible in browser history and the DOM.

### 1.3 Authority & Threshold Architecture
- **Threshold Scheme**: Shamir's Secret Sharing over Galois Field $\text{GF}(256)$ with irreducible polynomial $0x11b$ ([`src/security/threshold.ts`](file:///c:/Users/Prakash/Desktop/VoteChain/src/security/threshold.ts)).
- **Share Generation**: `splitElectionSecret(electionId, secret, totalShares = 3, threshold = 2)` generates deterministic pseudorandom polynomials keyed by the per-election DEK.
- **Current Approval Flow**: [`src/app/api/authority/elections/[electionId]/approval/route.ts`](file:///c:/Users/Prakash/Desktop/VoteChain/src/app/api/authority/elections/%5BelectionId%5D/approval/route.ts):
  - Fetches all users with `role: "AUTHORITY"` ordered by `createdAt: "asc"`.
  - Determines $x$-coordinate by finding `authorities.findIndex(a => a.id === user.id)`.
  - Assigns share `shares[authIndex % total]`.
  - **Identified Architectural Fragility**: If the number of authorities globally changes or an authority account is deleted/re-created, `authIndex` shifts for subsequent authorities, causing their $x$-coordinate to change. This confirms that unconstrained global authority additions without an immutable election-specific trustee binding will corrupt Shamir key reconstruction.

### 1.4 Admin Account & Role Routing
- **Admin Seeding**: Seeded via [`prisma/seed.ts`](file:///c:/Users/Prakash/Desktop/VoteChain/prisma/seed.ts) reading `ADMIN_EMAIL` (defaulting to `admin@votechain.local`) and `ADMIN_PASSWORD`.
- **Authentication**: `POST /api/auth/login` uses `bcrypt.compare(password, user.passwordHash)`.
- **Role Routing**: [`src/backend/auth/role-routing.ts`](file:///c:/Users/Prakash/Desktop/VoteChain/src/backend/auth/role-routing.ts) routes `ADMIN` $\to$ `/`, `AUTHORITY` $\to$ `/authority`, `OBSERVER` $\to$ `/observer`, `VOTER` $\to$ `/portal`.
- **Existing Admin Reset Script**: [`scripts/create-or-reset-admin.ts`](file:///c:/Users/Prakash/Desktop/VoteChain/scripts/create-or-reset-admin.ts) currently accepts the password as a command-line argument (`process.argv[3]`), creating a vulnerability where passwords leak into shell history and process lists.

### 1.5 Database Migration Status
- **Inspection of Repository**: The repository contains `prisma/migrations/20260928000000_init_votechain` along with `prisma/migrations/migration_lock.toml`.
- **Package Scripts**: [`package.json`](file:///c:/Users/Prakash/Desktop/VoteChain/package.json) defines `"db:migrate": "prisma migrate deploy"` alongside `"db:push": "prisma db push"`.
- **Production Standard**: Because Prisma migrations are tracked in source control and deployed to Neon PostgreSQL, using `prisma db push` in production poses risks of bypassing migration history. A strict migration protocol must be followed.

### 1.6 Observer Role Findings
- **Role**: `OBSERVER` exists in `UserRole` enum.
- **Access**: Routes to `/observer` ([`src/app/observer/page.tsx`](file:///c:/Users/Prakash/Desktop/VoteChain/src/app/observer/page.tsx)).
- **Current Observation Model**: Requires creating a dedicated `User` record with email, password, and `role: "OBSERVER"`.
- **Identified Architectural Inefficiency**: Election observers are typically election auditors, student representatives, or external faculty who only need temporary, read-only visibility into a single specific election. Requiring the admin to invite and manage full user accounts for observers creates unnecessary credential overhead and risks account bloat.

---

## 2. Admin Account Plan & Secure Provisioning

### 2.1 Identity Transition to `admin.votechain@gmail.com`
The target administrator account identity is:
- **Email**: `admin.votechain@gmail.com`
- **Role**: `ADMIN`
- **Status**: `ACTIVE`
- **Email Verified**: `true`
- **Password Security**: Bcrypt hash (12 salt rounds) stored in `User.passwordHash`. Plaintext passwords will never touch the database, source code, Git, terminal output, or logs.

### 2.2 Interactive Hidden-Prompt Provisioning CLI Design
Command-line arguments are visible to any local user via process table inspection tools (e.g., `ps aux`, `Get-Process`, Windows Task Manager) and are recorded in shell history files (`~/.bash_history`, `~/.zsh_history`, PowerShell `ConsoleHost_history.txt`).

**Strict CLI Design Specification**:
The provisioning tool [`scripts/create-or-reset-admin.ts`](file:///c:/Users/Prakash/Desktop/VoteChain/scripts/create-or-reset-admin.ts) will be restructured to forbid command-line password arguments:

1. **Invocation**:
   ```powershell
   npx tsx --env-file=.env scripts/create-or-reset-admin.ts [admin.votechain@gmail.com]
   ```
   - If the email argument is omitted, it defaults to `admin.votechain@gmail.com`.
   - **Command-line arguments containing passwords will be explicitly rejected**: If `process.argv.length > 3`, the script aborts immediately with an error instructing the user not to provide passwords as arguments.

2. **Secure Interactive Prompting**:
   - The script initializes an interactive terminal session using Node.js `readline` with muted stdout or raw terminal mode (`process.stdin.setRawMode(true)`).
   - **Prompt 1**: `"Enter new admin password: "` $\to$ input characters are masked (rendering nothing or `*` without echoing plaintext to the terminal).
   - **Prompt 2**: `"Confirm new admin password: "` $\to$ input characters are masked.
   - **Validation**:
     - Passwords must match exactly.
     - Password must satisfy the centralized password policy with administrative minimum length ($\ge 12$ characters).
   - **Immediate Memory Hygiene**:
     - Plaintext password buffers are hashed using `bcrypt.hash(password, 12)` immediately.
     - Variables referencing plaintext password strings are dereferenced or overwritten where possible.
   - **Zero Leaks**:
     - No password in shell history.
     - No password in process arguments.
     - No password in application or database logs.
     - No password echoed to terminal screen.

3. **Database Write**:
   - Updates or inserts the `admin.votechain@gmail.com` record with the resulting `passwordHash`.
   - Admin account status set to `ACTIVE`, `emailVerified: true`, `role: "ADMIN"`.

### 2.3 Gmail App Password Secret Management
- The admin Gmail App Password is used solely by the server-side mailer to dispatch authority invitations.
- **Location**: Configured strictly as a server-side environment secret: `ADMIN_EMAIL_APP_PASSWORD`.
- **Database Isolation**: The Gmail App Password **must NEVER be stored in the database**. It resides only in `.env` (local) and Vercel Environment Variables (production).
- **Client Isolation**: It must never be prefixed with `NEXT_PUBLIC_` and must never appear in any client-side bundle or API response.

### 2.4 Deprecation of Development Admin Account
- The initial development account `admin@votechain.local` will be deactivated (`status: "SUSPENDED"`) or safely removed once `admin.votechain@gmail.com` is verified, preventing confusion and multi-admin credential risks.

---

## 3. Gmail / SMTP Dual-Sender Infrastructure Plan

### 3.1 Dual-Sender Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TRANSACTIONAL EMAIL SYSTEM                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
           ┌────────────────────────┴────────────────────────┐
           ▼                                                 ▼
┌───────────────────────────────────────┐ ┌───────────────────────────────────────┐
│           CHANNEL 1: VOTER            │ │          CHANNEL 2: ADMIN             │
│        votechain.verify@gmail.com     │ │       admin.votechain@gmail.com       │
├───────────────────────────────────────┤ ├───────────────────────────────────────┤
│ • Student email verifications         │ │ • Authority trustee invitations       │
│ • Student voter password resets       │ │ • Administrative security notices     │
│ • High volume / automated traffic     │ │ • Low volume / high trust traffic     │
└───────────────────────────────────────┘ └───────────────────────────────────────┘
```

#### Why Dual-Sender is Retained:
1. **Rate-Limit Isolation**: Free Gmail accounts enforce a daily sending limit (~500 emails/day). High student voter traffic during campus elections will not exhaust the quota required for administrative authority trustee invitations.
2. **Deliverability & Reputation**: Separating student registration emails from faculty invitations protects trustee invitations from spam filter throttling.
3. **Independent Revocation**: Each Google account maintains its own App Password generated under its own 2FA. Revoking or rotating voter mailer credentials does not break administrative communications.
4. **Graceful Fallback**: If `ADMIN_EMAIL_APP_PASSWORD` is omitted in development, the system falls back gracefully to `EMAIL_APP_PASSWORD`, ensuring zero friction for local testing.

### 3.2 Environment Variable Naming Specification

| Variable Name | Required Scope | Purpose | Example / Format |
| :--- | :--- | :--- | :--- |
| `EMAIL_USER` | Server-only (`.env`, Vercel) | Voter verification & password reset sender | `votechain.verify@gmail.com` |
| `EMAIL_APP_PASSWORD` | Server-only (`.env`, Vercel) | 16-character Google App Password for voter mailer | `abcd efgh ijkl mnop` (no spaces) |
| `ADMIN_EMAIL_USER` | Server-only (`.env`, Vercel) | Authority invitation sender & admin identity | `admin.votechain@gmail.com` |
| `ADMIN_EMAIL_APP_PASSWORD`| Server-only (`.env`, Vercel) | 16-character Google App Password for admin mailer | `qrst uvwx yz12 3456` (no spaces) |

> **STRICT SECURITY RULE**: These variables must **NEVER** have the `NEXT_PUBLIC_` prefix, must **NEVER** be committed to Git, and must **NEVER** appear in client-rendered components.

---

## 4. Authority Trustee Invitation System

### 4.1 Domain Flexibility
Unlike student voter registration (which is strictly restricted to `@psgtech.ac.in`), authority trustee emails **must not be restricted by domain**. Valid authority emails include:
- Personal Gmail: `professor.smith@gmail.com`
- Institutional / College: `dean@psgtech.ac.in`, `hod_cse@annauniv.edu`
- External Trust Partner: `trustee@electionguard.org`

### 4.2 End-to-End Invitation Workflow

```
[ ADMIN ACTION ]
Admin opens Admin Dashboard → "Authorities" Tab → Clicks "Invite Authority"
                        │
                        ▼
Admin enters: Full Name ("Dr. Eleanor Vance") & Email ("eleanor.vance@gmail.com")
                        │
                        ▼
[ CONFIRMATION MODAL ]
UI displays: "Send official authority invitation to Dr. Eleanor Vance at eleanor.vance@gmail.com?"
                        │
                        ▼
Admin clicks "Confirm & Send Invitation"
                        │
                        ▼
[ BACKEND API: POST /api/admin/authorities/invite ]
1. Verify caller has role ADMIN (requireAdminApi)
2. Check email uniqueness across all User records
3. Ensure email is not in any active election voter eligibility list
4. Create User record:
   - email: "eleanor.vance@gmail.com"
   - name: "Dr. Eleanor Vance"
   - role: "AUTHORITY"
   - status: "INVITED"
   - emailVerified: false
   - passwordHash: "<unusable_random_marker>"
5. Generate 32-byte CSPRNG token (rawToken)
6. Calculate tokenHash = SHA-256(rawToken)
7. Store tokenHash in VerificationToken table:
   - userId: user.id
   - type: "AUTHORITY_INVITATION"
   - expiresAt: now() + 48 hours
8. Send invitation email via admin.votechain@gmail.com:
   - Subject: "VoteChain — Invitation to serve as Election Authority Trustee"
   - Link: https://votechain.../authority/setup?token=<rawToken>
   (RAW TOKEN IS NEVER LOGGED ON SERVER)
9. Record audit log: AUTHORITY_INVITED (referencing userId, never token)
                        │
                        ▼
[ AUTHORITY ACTION ]
Trustee opens email and clicks secure setup link
                        │
                        ▼
[ SETUP PAGE: /authority/setup?token=<rawToken> ]
1. Page loads in browser
2. IMMEDIATE URL SANITIZATION:
   - Frontend extracts rawToken from URL parameter into memory
   - Frontend IMMEDIATELY calls window.history.replaceState({}, document.title, "/authority/setup")
   - Token is stripped from address bar, browser history, and Referer headers
3. Frontend validates token against GET /api/authority/verify-token (via POST or secure body)
4. Displays Activation Form:
   - Trustee Name & Email displayed (read-only)
   - "Create Secret Password" & "Confirm Password"
   - Real-time password complexity checklist
                        │
                        ▼
[ ACTIVATION API: POST /api/authority/activate ]
1. Backend validates tokenHash and password complexity
2. Hashes password with Bcrypt (cost factor 12)
3. Transactional update:
   - User.passwordHash = newBcryptHash
   - User.status = ACTIVE
   - User.emailVerified = true
   - VerificationToken.usedAt = now() (IMMEDIATELY BURNED)
4. Audit log: AUTHORITY_ACTIVATED
5. Auto-login / Redirect to /authority (Trustee Console)
```

### 4.3 Invitation Token Cryptographic & Operational Protection Rules
To guarantee zero token leakage across the lifecycle:

1. **Generation & Entropy**:
   - Generated using `crypto.randomBytes(32)` (256 bits of CSPRNG entropy).
   - Represented as a 64-character lowercase hexadecimal string.
2. **Hashed at Rest**:
   - Only `SHA-256(rawToken)` is stored in `VerificationToken.tokenHash`.
   - Read-only database compromise reveals zero usable tokens.
3. **Strict Zero-Logging Mandate**:
   - **Raw tokens must NEVER be logged anywhere**:
     - No console output (`console.log`, `console.info`, `console.debug`).
     - No server error logs (error handlers must sanitize URLs and request bodies).
     - No audit logs (audit entries log only `userId`, `action`, and timestamp).
     - No analytics or monitoring telemetry.
4. **Immediate Browser URL Stripping**:
   - Upon page mount at `/authority/setup`, the raw token is read into component state and immediately wiped from the browser URL:
     ```ts
     // Immediately scrub raw token from URL without triggering a page reload
     window.history.replaceState({}, document.title, window.location.pathname);
     ```
   - Prevents shoulder-surfing, browser history logging, and leakage via `Referer` headers if external links are followed.
5. **No Client Persistence**:
   - Raw tokens **must NEVER be stored** in `localStorage`, `sessionStorage`, or client cookies.
   - Tokens exist only in component memory during the activation interaction.
6. **Atomic Single-Use Burning**:
   - When `/api/authority/activate` executes, the token record is marked `usedAt = new Date()` within an atomic database transaction.
   - Any replay attempt with the same token is rejected immediately with `TOKEN_REUSED`.
   - Expired tokens (`expiresAt < new Date()`) reject with `TOKEN_EXPIRED`. Used, expired, or invalid tokens can never be revived.
7. **Time-Limited Validity**:
   - Authority invitation tokens expire strictly 48 hours after generation.
8. **No Administrative Password Knowledge**:
   - The administrator never specifies, views, or receives the authority's password.

---

## 5. Authority Pool & Trustee Management

### 5.1 Admin Authority Dashboard Features
The Admin Dashboard ([`src/frontend/components/dashboard-client.tsx`](file:///c:/Users/Prakash/Desktop/VoteChain/src/frontend/components/dashboard-client.tsx)) will feature a comprehensive Trustee Register:

1. **Trustee Register Table**:
   - **Name & Email**: Displays trustee contact info and institutional affiliation.
   - **Status Badge**:
     - `ACTIVE`: Account activated, password set, ready for election trustee assignment.
     - `INVITED` (Pending): Invitation sent, awaiting trustee password creation.
     - `EXPIRED`: Invitation token expired without redemption.
   - **Assigned Elections Count**: Displays how many active/upcoming elections this authority is assigned to.
   - **Actions**:
     - **Resend Invitation**: For `INVITED` or `EXPIRED` authorities; generates a fresh token, invalidates prior tokens, and re-dispatches invitation email.
     - **Cancel Invitation**: For pending invitations; deletes the unactivated user record and cancels token.
     - **Remove Authority**: For `ACTIVE` authorities; allowed **only if** the authority has never participated in any election approvals or key share generation.
2. **Strict Authority Role Restrictions**:
   - Authorities cannot access admin routes (`/api/admin/*` $\to$ HTTP 403).
   - Authorities cannot invite, edit, or delete other authorities.
   - Authorities cannot cast ballots (`checkVoterElectionEligibility` $\to$ HTTP 403 `NOT_VOTER`).
   - Authority console (`/authority`) is strictly dedicated to reviewing closed elections where they are assigned as trustees and approving key shares.
3. **Zero Secret Exposure**:
   - UI and API responses will **never** display Shamir secret shares, reconstructed DEKs, private keys, or token hashes.

---

## 6. Threshold Architecture: Global Authority Pool + Election-Specific Trustee Assignment

### 6.1 Architectural Analysis of Options

| Architectural Model | Description | Fatal Flaw / Trade-off | Evaluation |
| :--- | :--- | :--- | :--- |
| **Option A: Fixed 3 Globally** | Exactly 3 authorities exist across the entire platform. All 3 serve on every election. | Cannot onboard new faculty or rotate members without destroying historical accounts. | Inflexible |
| **Option B: Unconstrained Global $k$-of-$N$** | Arbitrary number of authorities globally. Every election uses all global authorities. | **Shamir Coordinate Drift**: Adding or deleting an authority shifts `authorities.findIndex()`, corrupting $x$-coordinates for all past and active elections. | **UNACCEPTABLE / CRITICAL RISK** |
| **Option C: Global Pool + Election Assignment** | Arbitrary pool of active authorities. Admin assigns exactly 3 trustees to Slots 1, 2, and 3 ($x = 1, 2, 3$) per election. | Requires election-to-trustee relational mapping table (`ElectionTrustee`). | **SUPERIOR & RECOMMENDED** |

### 6.2 Architectural Invariants & Flow Diagram

The system maintains a **Global Authority Pool** alongside **Election-Specific Trustee Assignments**:

```
Global Authority Pool
        |
        | Admin selects exactly 3 authorities
        v
Election-Specific Trustees
        |
   +----+----+
   |    |    |
   v    v    v
  T1   T2   T3
        |
        v
     2-of-3
   threshold
```

#### Detailed Invariants:
1. **Unbounded Global Authority Pool**:
   - There is **no fixed global authority count**.
   - The organization can register and maintain an arbitrary pool of eligible, active authorities (e.g., 3, 5, 10, or 20 faculty trustees).
2. **Exact 3-Trustee Assignment Per Election**:
   - For every modern election created in VoteChain, the administrator selects **exactly 3 eligible/active authorities** from the global pool.
   - These 3 authorities are assigned to immutable election slots:
     - Trustee 1 $\to$ **Slot 1** ($x = 1$)
     - Trustee 2 $\to$ **Slot 2** ($x = 2$)
     - Trustee 3 $\to$ **Slot 3** ($x = 3$)
3. **Strict 2-of-3 Threshold**:
   - The threshold requirement is strictly **2-of-3** (`requiredAuthorityApprovals: 2`, `totalAuthorityApprovals: 3`).
   - Any valid combination of 2 assigned trustees (Slot 1 + Slot 2, Slot 1 + Slot 3, or Slot 2 + Slot 3) can reconstruct the per-election DEK and decrypt ballots.
   - A single share (1-of-3) is cryptographically incapable of reconstructing the secret.
   - Duplicate shares from the same slot (e.g. Slot 1 + Slot 1) are rejected.
4. **Total Exclusion of Unassigned Authorities**:
   - Authorities who are **NOT** selected for an election have **NO role, NO share, and NO authority** in that election's approval, key generation, or tally decryption.
   - They will not see the election in their pending approval queue, cannot generate shares for it, and any attempted approval returns HTTP 403 `FORBIDDEN_NOT_ASSIGNED_TRUSTEE`.
5. **Cross-Election Reuse**:
   - The same authority can serve as a trustee across multiple different elections (e.g., Dr. Vance can be Slot 1 for Election A and Slot 3 for Election B).
6. **Immutable Slot Locking**:
   - Slot assignments ($x = 1, 2, 3$) are **permanently locked** once the election transitions out of `DRAFT` (to `UPCOMING` or `ACTIVE`).
   - Adding, removing, or reordering authorities in the global pool **never alters** historical or active election shares, because coordinates are bound directly to `(electionId, slotIndex)` rather than array query order.
7. **Pre-Voting Trustee Validation**:
   - The backend enforces that an election **cannot proceed to active voting** or threshold operations unless **exactly 3 active trustees** are assigned.
8. **No Generalized $k$-of-$N$**:
   - Generalized $k$-of-$N$ schemes (e.g. 3-of-5, 4-of-7) will **NOT** be implemented at this time. The architecture remains strictly 2-of-3 with 3 assigned trustees.
9. **Backward Compatibility Fallback**:
   - Historical Phase 1–14 elections without explicit `ElectionTrustee` rows gracefully fall back to resolving the first 3 authorities by `createdAt: "asc"`.

### 6.3 Database Schema Representation

```prisma
model ElectionTrustee {
  id          String   @id @default(cuid())
  electionId  String
  election    Election @relation(fields: [electionId], references: [id], onDelete: Cascade)
  authorityId String
  authority   User     @relation(fields: [authorityId], references: [id], onDelete: Restrict)
  slotIndex   Int      // Exactly 1, 2, or 3 (permanent Shamir x-coordinate)
  createdAt   DateTime @default(now())

  @@unique([electionId, authorityId])
  @@unique([electionId, slotIndex])
  @@index([authorityId])
  @@index([electionId])
}
```

---

## 7. Election-Specific Observer Access Code System

### 7.1 Motivation & Accountless Observation Model
In traditional setups, observers (external auditors, department observers, student oversight bodies) are provisioned full user accounts. This introduces substantial friction:
- Requires inviting observers via email and setting up user accounts.
- Requires observers to maintain passwords.
- Creates account sprawl across semesters.
- Risks cross-election data leakage if an observer can view all active elections on the platform.

**Core Architectural Shift**:
- **Admin invitations are reserved exclusively for `AUTHORITY` users.**
- The admin **does NOT need to manage individual observer accounts.**
- Observers do **NOT** require username/password accounts.
- Access is granted through an **Election-Specific Observer Access Code**.
- An observer access code grants read-only auditing access **ONLY to that specific election**. (An access code for Election A cannot access Election B).

### 7.2 High-Level Workflow

```
[ ADMIN ACTION ]
Admin creates election or opens Election Controls → Clicks "Observer Access Code"
                        │
                        ▼
Backend generates high-entropy code: e.g. "VC-OBS-7K9P-4M2X"
Backend stores SHA-256(code) in Election record (Election.observerAccessCodeHash)
Admin copies code and distributes to authorized student/faculty observer
(PLAINTEXT CODE IS NEVER STORED IN DATABASE, NEVER LOGGED)
                        │
                        ▼
[ OBSERVER ACTION ]
Observer navigates to VoteChain Public Portal → Clicks "Observe Election"
                        │
                        ▼
[ OBSERVER ENTRY: /observe or /elections/[id]/observe ]
Observer enters Election-Specific Access Code
                        │
                        ▼
[ VALIDATION API: POST /api/elections/[id]/observe/validate ]
1. Apply rate-limiting (max 5 failed attempts per IP per 15 minutes)
2. Hash incoming code: testHash = SHA-256(rawCode)
3. Compare against Election.observerAccessCodeHash
4. If match:
   - Issue lightweight, scoped observer session token (e.g. encrypted cookie or signed JWT)
   - Scope: { role: "OBSERVER", electionId: "..." }
   - Duration: Scoped to election lifecycle / active session
                        │
                        ▼
[ SCOPED READ-ONLY DASHBOARD ]
Observer views real-time election integrity dashboard for THAT SPECIFIC ELECTION ONLY
```

### 7.3 Cryptographic Generation & Storage Rules

1. **High-Entropy Generation**:
   - Generated using a cryptographically secure random number generator (CSPRNG).
   - The observer access code MUST contain at least **128 bits of effective entropy**.
   - The implementation must use a sufficiently large random character set and/or sufficient random character length to achieve at least 128 bits of entropy.
   - Ambiguous characters such as `0`, `O`, `I`, and `1` may be excluded for usability, provided the resulting character set and code length still provide at least 128 bits of entropy.
   - A human-readable format such as `VC-OBS-XXXX-XXXX-XXXX-XXXX` may be used, provided the actual random character count and character set provide at least 128 bits of entropy.
   - The implementation must calculate the effective entropy from the actual character set and random length rather than assuming that a visual format automatically provides sufficient entropy.

2. **Hashed at Rest**:
   - Only `SHA-256(rawCode)` or Bcrypt hash is stored in the database:
     `Election.observerAccessCodeHash`.
   - The plaintext access code is displayed to the admin **once** upon generation/regeneration.
   - The plaintext code is **never stored in the database** and **never logged**.
   - After generation, VoteChain must not provide a mechanism to recover the original plaintext code.
   - If the admin loses the code, the recovery mechanism is **Regenerate Access Code**, which invalidates the previous code and generates a new code.

3. **Admin Regeneration & Revocation**:
   - The admin can click **"Regenerate Access Code"** at any time.
   - This immediately overwrites `Election.observerAccessCodeHash` with the hash of a new code, instantly invalidating any prior access codes.
   - The admin can also **revoke** access by nullifying `Election.observerAccessCodeHash`.
   - Regeneration must not reveal or recover the previous plaintext code.

4. **Lifecycle & Expiration**:
   - Access codes are valid only while the election is in `ACTIVE`, `CLOSED`, or `RESULTS_PUBLISHED` state.
   - Codes automatically become inactive once election auditing is formally concluded.

### 7.4 Brute-Force & Rate-Limiting Defenses
- To prevent brute-force attacks against access codes:
  - Strict rate limiting: Maximum of 5 incorrect attempts per client IP / election per 15 minutes.
  - Progressive exponential backoff delay on failed code verification.
  - Constant-time hash comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.

### 7.5 Strict Read-Only Observer Permissions Matrix

| Capability / Action | Observer Permission | Security Enforcement |
| :--- | :--- | :--- |
| **View Election Status & Metadata** | **ALLOWED** | Read-only election title, start/end times, and status |
| **View Candidate List** | **ALLOWED** | Read-only candidate names, affiliations, and sort orders |
| **View Vote / Receipt Counters** | **ALLOWED** | Anonymized total votes cast, verified receipts count |
| **View Blockchain Commitments** | **ALLOWED** | Sepolia transaction hashes, block numbers, Merkle roots |
| **Interactive Tamper Detection** | **ALLOWED** | Read-only micro-blockchain ledger and Merkle validation |
| **View Audit Logs for this Election** | **ALLOWED** | Filtered audit events relating to the specific election |
| **View Final Results** | **ALLOWED** | Tally results once election reaches `RESULTS_PUBLISHED` |
| **Cast Ballot** | **STRICTLY BLOCKED** | Returns HTTP 403; cannot access voter voting pipeline |
| **Modify Election / Candidates** | **STRICTLY BLOCKED** | Returns HTTP 403; cannot modify election configuration |
| **Add / Edit Eligibility List** | **STRICTLY BLOCKED** | Returns HTTP 403; cannot upload voter CSVs |
| **Open / Close Election** | **STRICTLY BLOCKED** | Returns HTTP 403; cannot alter election lifecycle |
| **Manage Authorities** | **STRICTLY BLOCKED** | Returns HTTP 403; cannot invite or assign authorities |
| **Access Threshold Key Shares** | **STRICTLY BLOCKED** | Key shares and DEKs are completely inaccessible |
| **Decrypt Ballots** | **STRICTLY BLOCKED** | Has zero access to Shamir polynomials or decryption keys |
| **Access Other Elections** | **STRICTLY BLOCKED** | Session is strictly locked to the single verified `electionId` |

### 7.6 Backward Compatibility with Existing `OBSERVER` Role
- The existing user-based `OBSERVER` role in [`src/app/observer/page.tsx`](file:///c:/Users/Prakash/Desktop/VoteChain/src/app/observer/page.tsx) will be preserved for backward compatibility so that existing seeded accounts (`observer@votechain.local`) continue to function without breaking tests.
- Modern classroom workflows will use the election-specific access code system, eliminating the need to create new observer user accounts.

---

## 8. Universal Forgot Password Flow

### 8.1 Scope & Account Boundaries
- **Supported Roles**: `VOTER`, `AUTHORITY`, and legacy `OBSERVER`.
- **Admin Account Exception**: Administrative password resets are strictly prohibited via the web forgot-password flow. Admin credentials can only be reset via the interactive CLI utility [`scripts/create-or-reset-admin.ts`](file:///c:/Users/Prakash/Desktop/VoteChain/scripts/create-or-reset-admin.ts) with direct database access. This prevents administrative account takeover via email interception.

### 8.2 End-to-End Workflow

```
[ USER ACTION ]
User clicks "Forgot password?" on /login
                        │
                        ▼
[ PAGE: /forgot-password ]
User enters registered email address (e.g. "student@psgtech.ac.in")
                        │
                        ▼
[ API: POST /api/auth/forgot-password ]
1. Input normalization: email.trim().toLowerCase()
2. Strict rate-limiting check (max 5 requests per IP / email per hour)
3. Database lookup for User by email
4. CONSTANT-TIME / NON-ENUMERATING RESPONSE:
   Always return HTTP 200:
   "If an account exists for this email address, a password reset link has been sent."
   (Prevents user account enumeration attacks)
5. IF user exists, status == ACTIVE, and role != ADMIN:
   a. Invalidate any existing unused PASSWORD_RESET tokens for this user
   b. Generate 32-byte CSPRNG token (rawToken)
   c. Calculate tokenHash = SHA-256(rawToken)
   d. Store in VerificationToken:
      - userId: user.id
      - type: "PASSWORD_RESET"
      - expiresAt: now() + 1 hour (short validity window)
   e. Dispatch email via votechain.verify@gmail.com:
      - Subject: "VoteChain — Reset your password"
      - Link: https://votechain.../reset-password?token=<rawToken>
      (RAW TOKEN IS NEVER LOGGED ON SERVER)
   f. Record audit log: PASSWORD_RESET_REQUESTED (referencing userId, never token)
                        │
                        ▼
[ USER ACTION ]
User clicks link in email within 1 hour
                        │
                        ▼
[ PAGE: /reset-password?token=<rawToken> ]
1. Page loads in browser
2. IMMEDIATE URL SANITIZATION:
   - Frontend extracts rawToken from URL parameter into memory
   - Frontend IMMEDIATELY calls window.history.replaceState({}, document.title, "/reset-password")
   - Token is stripped from address bar and browser history
3. Form displays:
   - "New Password" & "Confirm Password"
   - Real-time password policy validation feedback
                        │
                        ▼
[ API: POST /api/auth/reset-password ]
1. Backend validates tokenHash (must exist, type == PASSWORD_RESET, usedAt == null, expiresAt > now())
2. Backend validates password against centralized Password Policy
3. Hashes new password with Bcrypt (cost factor 12)
4. Transactional update:
   - User.passwordHash = newBcryptHash
   - VerificationToken.usedAt = now() (IMMEDIATELY BURNED)
5. Record audit log: PASSWORD_RESET_COMPLETED
6. Redirect user to /login with success banner: "Password successfully updated. Please sign in."
```

### 8.3 Reset Token Protection Rules
1. **Zero Logging**: Raw reset tokens are never written to server logs, audit logs, or error traces.
2. **Immediate URL Stripping**: Frontend scrubs the reset token from the browser address bar immediately upon component mount using `window.history.replaceState`.
3. **No Client Storage**: Reset tokens are never written to `localStorage`, `sessionStorage`, or cookies.
4. **Immediate Single-Use Invalidation**: `usedAt` is stamped atomically upon password update. Replay attempts fail immediately. Expired tokens (lifetime: 1 hour) are permanently rejected.

---

## 9. Centralized Password Policy

### 9.1 Unified Policy Specification
Based on VoteChain's cryptographic threat model and NIST SP 800-63B guidelines:

| Rule | Requirement | Rationale |
| :--- | :--- | :--- |
| **Minimum Length** | **10 characters** (Configurable: `MIN_PASSWORD_LENGTH`) | Balances voter usability with resistance to GPU dictionary attacks. (Admin/Authority CLI enforces $\ge 12$). |
| **Uppercase Letter** | At least 1 `[A-Z]` | Increases search space complexity. |
| **Lowercase Letter** | At least 1 `[a-z]` | Enforces mixed-case entropy. |
| **Numeric Digit** | At least 1 `[0-9]` | Prevents dictionary phrase-only passwords. |
| **Special Symbol** | At least 1 `[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]` | Guards against rainbow table pre-computation. |
| **Maximum Length** | 1024 characters | Prevents Bcrypt DoS long-string attacks. |

### 9.2 Centralized Policy Definition Module
The password policy will be implemented in [`src/backend/auth/auth-validation.ts`](file:///c:/Users/Prakash/Desktop/VoteChain/src/backend/auth/auth-validation.ts):

```ts
export const DEFAULT_MIN_PASSWORD_LENGTH = 10;

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
  reason?: string;
}

export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  const minLength = Number(process.env.MIN_PASSWORD_LENGTH || DEFAULT_MIN_PASSWORD_LENGTH);
  const errors: string[] = [];

  if (typeof password !== "string") {
    return { valid: false, errors: ["Password must be text."], reason: "Password must be text." };
  }
  if (password.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters long.`);
  }
  if (password.length > 1024) {
    errors.push("Password cannot exceed 1024 characters.");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter (A-Z).");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter (a-z).");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number (0-9).");
  }
  if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
    errors.push("Password must contain at least one special symbol (e.g. !@#$%^&*).");
  }

  return {
    valid: errors.length === 0,
    errors,
    reason: errors.join(" "),
  };
}
```

### 9.3 Enforcement Points Across Application
This single validation routine will be enforced across:
1. Student voter registration (`registerStudentVoter`)
2. Authority account activation (`activateAuthorityAccount`)
3. User password reset (`resetUserPassword`)
4. Admin account creation / reset (`createOrResetAdmin`)
5. Frontend validation hooks across all password input forms

---

## 10. Database Impact & Production Migration Strategy

### 10.1 Inspection of Repository Migration Pattern
- **Existing Migration History**:
  - The repository utilizes Prisma Migrate.
  - The migration folder [`prisma/migrations/20260928000000_init_votechain`](file:///c:/Users/Prakash/Desktop/VoteChain/prisma/migrations/20260928000000_init_votechain) contains the base schema definition, and `migration_lock.toml` locks the provider to `postgresql`.
  - [`package.json`](file:///c:/Users/Prakash/Desktop/VoteChain/package.json) contains `"db:migrate": "prisma migrate deploy"`.
- **Risks of `prisma db push`**:
  - Running `prisma db push` bypasses the migration history table (`_prisma_migrations`).
  - In a production environment connected to Neon PostgreSQL and Vercel, `db push` can cause migration desynchronization or unintended schema divergence.

### 10.2 Recommended Production-Safe Migration Procedure
Prior to applying changes during the implementation phase:
1. **Pre-Migration Inspection**:
   - Inspect the current migration status:
     ```powershell
     npx prisma migrate status
     ```
   - Verify that all existing migrations are applied cleanly to the target database.
2. **Generating Migration Artifacts**:
   - In development, generate an auditable, versioned SQL migration file:
     ```powershell
     npx prisma migrate dev --create-only --name add_authority_invitation_trustees_and_tokens
     ```
   - Review the generated SQL file in `prisma/migrations/` to guarantee that all operations are **purely additive** (no `DROP TABLE`, `DROP COLUMN`, or disruptive `NOT NULL` constraints without defaults).
3. **Applying Migrations in Production / CI**:
   - Apply the verified migration using the project's standard deploy script:
     ```powershell
     npx prisma migrate deploy
     ```
   - Run `npx prisma generate` to synchronize `@prisma/client` types.

### 10.3 Non-Destructive Additive Prisma Schema Changes

```prisma
// 1. Extend UserStatus enum to include INVITED
enum UserStatus {
  ACTIVE
  SUSPENDED
  INVITED       // NEW: Authority awaiting activation
}

// 2. Add TokenType enum to distinguish token purposes
enum TokenType {
  EMAIL_VERIFICATION      // Student registration email confirmation
  AUTHORITY_INVITATION    // Authority trustee invitation & activation
  PASSWORD_RESET          // Forgot password recovery
}

// 3. Extend VerificationToken model
model VerificationToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique
  type      TokenType @default(EMAIL_VERIFICATION)  // NEW: Token intent classifier
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, expiresAt])
  @@index([tokenHash])
  @@index([type, expiresAt])
}

// 4. Add ElectionTrustee model for Architecture Option C
model ElectionTrustee {
  id          String   @id @default(cuid())
  electionId  String
  election    Election @relation(fields: [electionId], references: [id], onDelete: Cascade)
  authorityId String
  authority   User     @relation(fields: [authorityId], references: [id], onDelete: Restrict)
  slotIndex   Int      // Exactly 1, 2, or 3 (permanent Shamir x-coordinate)
  createdAt   DateTime @default(now())

  @@unique([electionId, authorityId])
  @@unique([electionId, slotIndex])
  @@index([authorityId])
  @@index([electionId])
}

// 5. Extend Election model for Observer Access Code
// Inside model Election:
// observerAccessCodeHash  String?   // NEW: SHA-256 hash of election observer code
```

### 10.4 Backward Compatibility Guarantees
- **Enum Extension**: Adding `INVITED` to `UserStatus` does not alter any existing records.
- **Default Column Value**: `VerificationToken.type` defaults to `EMAIL_VERIFICATION`, ensuring all historical verification tokens remain valid.
- **Standalone Relational Table**: `ElectionTrustee` is an additive table. Historical Phase 1–14 elections without `ElectionTrustee` rows cleanly fall back to legacy order-based resolution.
- **Nullable Column**: `observerAccessCodeHash` is nullable, maintaining full compatibility with all existing elections.

---

## 11. API Changes Specification

### 11.1 New & Modified Endpoints Summary

| Endpoint | Method | Auth Required | Purpose |
| :--- | :--- | :--- | :--- |
| `POST /api/admin/authorities/invite` | `POST` | `ADMIN` only | Dispatches invitation email to prospective authority. |
| `POST /api/admin/authorities/[id]/resend` | `POST` | `ADMIN` only | Invalidates prior token and re-dispatches invitation email. |
| `DELETE /api/admin/authorities/[id]` | `DELETE` | `ADMIN` only | Removes authority (allowed only if no election approvals exist). |
| `GET /api/authority/verify-token` | `GET` | Public (Token-bound) | Validates invitation token before rendering setup page. |
| `POST /api/authority/activate` | `POST` | Public (Token-bound) | Validates token, sets password, burns token, activates user. |
| `POST /api/auth/forgot-password` | `POST` | Public (Rate-limited)| Sends password reset link (non-enumerating response). |
| `GET /api/auth/verify-reset-token` | `GET` | Public (Token-bound) | Validates reset token before rendering reset form. |
| `POST /api/auth/reset-password` | `POST` | Public (Token-bound) | Updates password, burns reset token. |
| `POST /api/elections/[id]/observer-code` | `POST` | `ADMIN` only | Generates or regenerates observer access code for election. |
| `DELETE /api/elections/[id]/observer-code`| `DELETE` | `ADMIN` only | Revokes observer access code for election. |
| `POST /api/elections/[id]/observe/validate`| `POST` | Public (Rate-limited)| Validates observer access code and issues scoped observation token. |
| `GET /api/admin/authorities` | `GET` | `ADMIN` only | Enhanced: Returns list with `INVITED` status and trustee assignment counts. |

---

## 12. Frontend Changes Specification

### 12.1 Pages & Components to Add or Update

1. **Admin Dashboard ([`src/frontend/components/dashboard-client.tsx`](file:///c:/Users/Prakash/Desktop/VoteChain/src/frontend/components/dashboard-client.tsx))**:
   - Update Authorities tab:
     - "Invite Authority" button (replaces "Add Authority").
     - Modal: Enter Name, Email $\to$ Confirmation prompt.
     - Status badges: `ACTIVE` (green), `INVITED` (amber with clock), `EXPIRED` (gray).
     - Action buttons: "Resend Invite" (for invited/expired), "Cancel Invite" (for invited), "Remove" (for unassigned active).
   - Update Election Controls:
     - Add "Observer Access Code" card/button: Allows generating, viewing (once), and regenerating observer access codes.
2. **Authority Activation Page (`src/app/authority/setup/page.tsx`)**:
   - New page: Validates token from URL.
   - **Immediate URL Sanitization**: Calls `window.history.replaceState` on mount to strip `?token=...` from the browser address bar.
   - Clean, dark-themed VoteChain form:
     - Trustee Name and Email displayed (read-only).
     - "Set Secret Password" & "Confirm Password" inputs.
     - Real-time password policy checklist (uppercase, lowercase, number, symbol, length).
     - Submit button $\to$ calls `/api/authority/activate`.
3. **Forgot Password Page (`src/app/forgot-password/page.tsx`)**:
   - New page: Accessible from `/login`.
   - Clean form: "Enter registered email address".
   - Non-enumerating feedback message upon submission.
4. **Password Reset Page (`src/app/reset-password/page.tsx`)**:
   - New page: Validates token from URL.
   - **Immediate URL Sanitization**: Calls `window.history.replaceState` on mount to strip `?token=...` from the browser address bar.
   - New Password & Confirm Password with policy validator.
   - Success redirect to `/login`.
5. **Login Page ([`src/app/login/page.tsx`](file:///c:/Users/Prakash/Desktop/VoteChain/src/app/login/page.tsx))**:
   - Add "Forgot your password?" link below password input.
6. **Observer Access Page (`src/app/observe/page.tsx` & `src/app/elections/[id]/observe/page.tsx`)**:
   - New accountless entry page:
     - Prompts user to select election and enter election observer access code.
     - Rate-limited submission $\to$ validates code against `/api/elections/[id]/observe/validate`.
     - On success, renders scoped read-only dashboard.
7. **Election Manager ([`src/frontend/components/election-manager.tsx`](file:///c:/Users/Prakash/Desktop/VoteChain/src/frontend/components/election-manager.tsx))**:
   - During election creation or draft editing, provide a Trustee Selector:
     - Administrator selects exactly 3 authorities from the active global pool.
     - Designates Slot 1, Slot 2, and Slot 3.
     - Displays validation error if fewer or more than 3 trustees are selected.

---

## 13. Comprehensive Security Review & Threat Modeling

| Threat Vector | Attack Scenario | Cryptographic & Architectural Mitigation |
| :--- | :--- | :--- |
| **Account Enumeration** | Attacker probes `/forgot-password` with emails to harvest valid student or faculty accounts. | **Non-enumerating responses**: The API always returns an identical success message (`"If an account exists..."`) with uniform response timing regardless of email existence. |
| **Invitation Token Replay** | Attacker intercepts setup link and attempts to reuse it after the authority activates. | **Atomic Token Burning**: Database transaction marks `usedAt = now()` upon activation. Subsequent requests reject with `TOKEN_REUSED`. |
| **Token Theft from Database** | Attacker gains read-only access to Neon database backup. | **Token Hashing at Rest**: Only `SHA-256(rawToken)` is stored. Raw 32-byte entropy exists only in the recipient's email link. |
| **Raw Token Leakage in Logs** | Developer or server logs print incoming request URLs containing raw tokens. | **Strict Zero-Logging Policy**: Error and request loggers strip sensitive query parameters (`token`, `code`) before logging. |
| **Token Exposure in Browser History / Referer** | User leaves browser open or clicks external link from setup page. | **Immediate URL Sanitization**: The frontend executes `window.history.replaceState` immediately upon mounting, purging the raw token from the address bar, history, and `Referer` headers. |
| **Token Theft from Client Storage** | Cross-Site Scripting (XSS) payload extracts tokens from browser storage. | **Zero Client Persistence**: Raw tokens are never stored in `localStorage`, `sessionStorage`, or cookies. They reside only in ephemeral component memory. |
| **Brute-Force Token Guessing** | Attacker scripts millions of requests trying random hex tokens. | **256-Bit Entropy**: $2^{256}$ search space makes brute force mathematically impossible. Rate limiting blocks probing. |
| **Expired Token Exploitation** | Authority attempts to activate a 2-week-old invitation. | **Strict Expiration Check**: Database validates `expiresAt > now()`. Expired tokens return `TOKEN_EXPIRED`. Admin can click "Resend Invite". |
| **Observer Access Code Brute Force** | Attacker attempts to guess the observer access code for an election. | **Rate-Limiting & Backoff**: Maximum 5 failed attempts per IP per 15 minutes; progressive backoff delay; high-entropy code format. |
| **Observer Privilege Escalation** | Observer attempts to vote or modify election parameters using observer token. | **Strict Scope Boundary**: Observer token grants access only to read-only observation routes; all mutation endpoints require `VOTER`, `AUTHORITY`, or `ADMIN` roles. |
| **Cross-Election Observer Leakage** | Observer with code for Election A attempts to view Election B. | **Election-Scoped Token**: The issued observer token encodes `electionId: "A"`; requests for Election B are rejected with HTTP 403. |
| **Authority Impersonation** | Malicious voter attempts to escalate their account to AUTHORITY via invitation endpoint. | **Strict Role Locking**: The user record is created with role `AUTHORITY` at invitation time; the activation endpoint cannot alter role or email. |
| **Unauthorized Trustee Creation** | Non-admin caller sends POST request to `/api/admin/authorities/invite`. | **Server-side RBAC Guard**: `requireAdminApi()` strictly validates caller's session role is `ADMIN`, returning HTTP 403 for voters/authorities/observers. |
| **Voter-Authority Collision** | An authority attempts to vote in an election they oversee. | **Role Isolation Guard**: `checkVoterElectionEligibility` rejects any non-`VOTER` role. CSV eligibility import rejects authority emails. |
| **Historical Tally Corruption** | Admin deletes an authority who participated in an earlier election. | **Audit Immutability Guard**: `DELETE` handler blocks deleting any authority with records in `ElectionAuthorityApproval` or completed elections. |
| **Threshold Bypass** | Admin attempts to decrypt results without 2-of-3 authority shares. | **Cryptographic Invariant**: `evaluateAuthorityThreshold` requires $\ge 2$ distinct valid shares. Global key bypass is strictly prohibited. |
| **Secret Exposure in UI/API** | Raw Shamir key shares or DEKs leak in client bundles or network requests. | **Data Sanitization**: `Election.encryptedMasterKey` and `ElectionAuthorityApproval.keyShare` are stripped from all public and admin API responses. |
| **Admin Password CLI Leakage** | Admin password leaks into shell history or process monitor during reset. | **Interactive Hidden Input**: CLI accepts zero password arguments; prompts interactively with masked input and confirmation. |

---

## 14. Backward Compatibility & Zero-Disruption Strategy

VoteChain has completed Phase 14 with a live Ethereum Sepolia contract, historical receipts, and certified elections. The new system will maintain 100% backward compatibility:

1. **Sepolia Smart Contract**: No contract redeployment or ABI modification. Contract address `0x7339F8B088A2835F26e158c9F96690395D80264D` remains untouched.
2. **Existing Authority Accounts**: The 3 existing seeded authorities (`authority@votechain.local`, `authority2@votechain.local`, `authority3@votechain.local`) remain active with `status = ACTIVE` and will continue to function.
3. **Existing Historical Elections**: Any historical election that does not have explicit `ElectionTrustee` assignment rows will gracefully fall back to the existing logic (`authorities ordered by createdAt: "asc"`), ensuring all historical tally verifications succeed.
4. **Existing Receipts & Merkle Proofs**: Receipt verification at `/verify` relies purely on `receiptId`, `txHash`, and Merkle roots; it is completely independent of the authority invitation or password recovery system.
5. **Existing Observer Account Compatibility**: The legacy `OBSERVER` user role and `/observer` route remain intact for seeded accounts.
6. **Additive Database Migrations**: All proposed Prisma schema additions (`UserStatus.INVITED`, `TokenType`, `ElectionTrustee`, `observerAccessCodeHash`) are purely additive with default values.

---

## 15. Testing Strategy

### 15.1 Unit & Cryptographic Tests (`tests/unit/`)
1. **Password Policy Suite (`password-policy.test.ts`)**:
   - Rejection of passwords $< 10$ characters.
   - Rejection of passwords missing uppercase, lowercase, numbers, or symbols.
   - Acceptance of compliant high-entropy passwords.
2. **Authority Invitation Suite (`authority-invitation.test.ts`)**:
   - Successful invitation token generation and SHA-256 hashing.
   - Acceptance of non-PSG domains (Gmail, institutional).
   - Single-use redemption: first activation succeeds, replay fails (`TOKEN_REUSED`).
   - Expiration validation: token past 48 hours is rejected (`TOKEN_EXPIRED`).
   - Invalidation of previous tokens upon resend.
3. **Forgot Password Suite (`forgot-password.test.ts`)**:
   - Non-enumerating response for both registered and unregistered emails.
   - Short expiration (1 hour) enforcement.
   - Password update with Bcrypt cost factor 12.
   - Invalidation of token after successful password reset.
4. **Threshold Architecture Suite (`threshold-trustee.test.ts`)**:
   - Election-specific trustee slot assignment stability ($x=1, 2, 3$).
   - Adding a 4th or 5th authority to global pool does not alter shares of existing elections.
   - Successful 2-of-3 reconstruction with assigned trustees.
   - Rejection of share submission from an authority not assigned to that election.
5. **Observer Access Code Suite (`observer-access.test.ts`)**:
   - Secure generation and SHA-256 hashing of access code.
   - Validation of valid code $\to$ returns scoped session token.
   - Rejection of incorrect code; rate-limiting triggering after 5 failed attempts.
   - Revocation / regeneration immediately invalidating previous code.
   - Strict read-only enforcement: blocking vote or mutation calls.

### 15.2 Contract & Integration Tests
- Verify all existing contract tests (`npm run test:contracts`) continue to pass 100%.
- Verify production build (`npm run build`) compiles cleanly with Turbopack.

---

## 16. Phased Implementation Roadmap

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PHASED IMPLEMENTATION ROADMAP                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    ▼                               ▼                               ▼
[ PHASE A ]                     [ PHASE B ]                     [ PHASE C ]
Environment & Email Core        Password Policy & DB Migration  Authority Invitation
• Dual Gmail transporter setup  • Centralize password policy    • Invite API & email dispatch
• Hidden-prompt Admin CLI       • Inspect prisma/migrations     • Setup page with URL scrubbing
• Zero-logging token utilities  • Generate additive migration   • Activation & audit logging
    │                               │                               │
    └───────────────────────────────┼───────────────────────────────┘
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    ▼                               ▼                               ▼
[ PHASE D ]                     [ PHASE E ]                     [ PHASE F ]
Authority Pool & Trustees       Forgot Password & Recovery      Observer Access Codes
• ElectionTrustee integration   • /forgot-password & reset      • Election access code system
• Fixed slot binding (x=1,2,3)  • URL scrubbing on reset page   • Hashed storage & rate limit
• Admin Dashboard UI updates    • Non-enumerating responses     • Scoped read-only dashboard
                                    │
                                    ▼
                              [ PHASE G ]
                      Comprehensive Verification
                      • Unit tests (100% pass)
                      • Contract test verification
                      • Next.js production build
```

### Detailed Phased Steps:

#### Phase A: Environment, Email Core & Secure Admin CLI
1. Update [`src/backend/auth/email.ts`](file:///c:/Users/Prakash/Desktop/VoteChain/src/backend/auth/email.ts):
   - `getVoterTransporter()`: uses `EMAIL_USER` and `EMAIL_APP_PASSWORD`.
   - `getAdminTransporter()`: uses `ADMIN_EMAIL_USER` and `ADMIN_EMAIL_APP_PASSWORD` (falls back gracefully to voter mailer if omitted).
2. Refactor [`scripts/create-or-reset-admin.ts`](file:///c:/Users/Prakash/Desktop/VoteChain/scripts/create-or-reset-admin.ts):
   - Forbid password arguments on command line.
   - Implement interactive terminal hidden input with confirmation.
   - Hash with Bcrypt cost factor 12.
3. Add secure token utility module with strict zero-logging wrappers.

#### Phase B: Centralized Password Policy & Production-Safe Database Migration
1. Update [`src/backend/auth/auth-validation.ts`](file:///c:/Users/Prakash/Desktop/VoteChain/src/backend/auth/auth-validation.ts) with `validatePasswordPolicy`.
2. Inspect [`prisma/migrations`](file:///c:/Users/Prakash/Desktop/VoteChain/prisma/migrations) and verify migration status (`npx prisma migrate status`).
3. Update [`prisma/schema.prisma`](file:///c:/Users/Prakash/Desktop/VoteChain/prisma/schema.prisma) with:
   - `UserStatus.INVITED`
   - `TokenType` enum
   - `VerificationToken.type`
   - `ElectionTrustee` model
   - `Election.observerAccessCodeHash`
4. Generate and deploy additive migration using `prisma migrate dev --create-only` and `prisma migrate deploy`.

#### Phase C: Authority Invitation & Activation Flow
1. Implement `POST /api/admin/authorities/invite` (dispatches email via `admin.votechain@gmail.com`).
2. Implement `POST /api/admin/authorities/[id]/resend`.
3. Implement `GET /api/authority/verify-token`.
4. Implement `POST /api/authority/activate`.
5. Create frontend activation page: `src/app/authority/setup/page.tsx` with immediate URL stripping (`history.replaceState`).

#### Phase D: Authority Pool & Election Trustee Assignment
1. Update election creation and lifecycle logic to require exactly 3 assigned trustees.
2. Update [`src/app/api/authority/elections/[electionId]/approval/route.ts`](file:///c:/Users/Prakash/Desktop/VoteChain/src/app/api/authority/elections/%5BelectionId%5D/approval/route.ts) to resolve Shamir $x$-coordinates strictly from `ElectionTrustee.slotIndex`.
3. Reject approval attempts from authorities not assigned to that election.
4. Update Admin Dashboard UI with trustee selector and authority register management.

#### Phase E: Forgot Password & Universal Recovery Flow
1. Implement `POST /api/auth/forgot-password` (non-enumerating).
2. Implement `GET /api/auth/verify-reset-token`.
3. Implement `POST /api/auth/reset-password`.
4. Create frontend pages:
   - `src/app/forgot-password/page.tsx`
   - `src/app/reset-password/page.tsx` (with immediate URL stripping)
5. Add "Forgot your password?" link to `src/app/login/page.tsx`.

#### Phase F: Election-Specific Observer Access Code System
1. Implement `POST /api/elections/[id]/observer-code` (code generation and SHA-256 hash storage).
2. Implement `DELETE /api/elections/[id]/observer-code` (revocation).
3. Implement `POST /api/elections/[id]/observe/validate` (rate-limited validation issuing scoped observation token).
4. Create accountless observer UI: `src/app/observe/page.tsx` and election observer dashboard.

#### Phase G: Comprehensive Testing & Verification
1. Implement unit test suites in `tests/unit/`.
2. Run test suite (`npm run test:unit` and `npm run test:contracts`).
3. Verify clean production build (`npm run build`).

---

## 17. Risks and Verification Checklist

### 17.1 Potential Risks & Mitigations
1. **Gmail Daily Sending Limit (~500 emails/day)**:
   - *Mitigation*: The dual-sender architecture isolates admin invitations (`admin.votechain@gmail.com`) from high-volume student voter traffic (`votechain.verify@gmail.com`).
2. **Email Spam Filtering**:
   - *Mitigation*: The Admin Dashboard displays the invitation link directly in the admin console for the administrator, allowing them to copy and share the secure setup link directly with faculty trustees if email delivery is delayed.
3. **Database Migration Safety**:
   - *Mitigation*: Strictly inspect existing migrations before applying; use auditable `prisma migrate deploy` rather than blind `db push`; all additions are purely additive.
4. **Observer Access Code Probing**:
   - *Mitigation*: Strict IP-based rate limiting (5 failed attempts per 15 min), exponential backoff, high entropy, constant-time verification.

### 17.2 Pre-Implementation Verification Checklist
- [x] Admin CLI password prompt redesigned to use hidden input and confirmation (no CLI arguments).
- [x] Token protection rules strictly formalized (zero logs, immediate URL stripping, no client storage, immediate single-use burning).
- [x] Database migration strategy updated to inspect existing migration history and use standard `prisma migrate deploy`.
- [x] Threshold architecture formalized with unbounded global pool, exact 3 assigned trustees, slots 1/2/3 ($x=1,2,3$), strict 2-of-3 threshold, and exclusion of unassigned authorities.
- [x] Exact ASCII flow diagram included in threshold architecture section.
- [x] Election-specific observer access code system designed with accountless flow, hashed storage, and read-only boundaries.
- [x] Dual email sender architecture, forgot-password flow, and password policy preserved intact.

---

## Conclusion & Next Steps

This updated planning document incorporates all required architectural refinements and security hardenings. It provides an unambiguous, robust, and backward-compatible blueprint ready for implementation.

**Status**:
- **AWAITING USER REVIEW & FINAL APPROVAL**.
- No implementation code, database migrations, or environment modifications will be made until explicit approval is granted.
