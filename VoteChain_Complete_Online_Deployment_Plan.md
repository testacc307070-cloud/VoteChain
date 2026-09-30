# VoteChain — Complete Online Deployment Plan

## 1. Locked Decisions

- Target: approximately 100 voters
- Election name: decided by the team later
- Public website: free hosting URL; no paid custom domain
- Registration: student self-registration
- Eligibility: Admin uploads official class voter list
- Allowed email: `@psgtech.ac.in`
- Verification sender: `votechain.verify@gmail.com`
- One vote per voter per election
- Database: suitable free-tier cloud PostgreSQL
- Blockchain: suitable public EVM testnet, selected when Phase 7 begins
- Smart contract deployment: automated project scripts; **no Remix**
- Ethereum Mainnet: not used
- Target cost: ₹0 / $0 where practical
- Workflow: one phase at a time → implement → test → report → STOP → review → next phase

## 2. Target Architecture

```text
Student
   |
   v
Public VoteChain Website (Next.js)
   |
   +----------------------+----------------------+
   |                                             |
   v                                             v
Cloud PostgreSQL                         Public EVM Testnet
   |                                             |
Users / Roles / Elections                VoteChainLedger.sol
Eligibility / Participation              Commitments / Events
Audit / App data                         Transactions / Blocks
   |
   v
Email Verification
   |
   v
votechain.verify@gmail.com
```

Students only need a browser and the public URL. They do not need GitHub, Ganache, PostgreSQL, Remix, MetaMask, or blockchain knowledge.

## 3. Technology Stack

### Application
- Next.js
- React
- TypeScript
- Prisma
- PostgreSQL
- Existing HTTP-only session authentication
- Existing bcrypt password hashing
- Gmail SMTP / existing Nodemailer email implementation

### Blockchain
- Solidity
- Existing `VoteChainLedger.sol`
- Ganache for local development only
- Public EVM testnet for online deployment
- Testnet RPC provider
- Existing automated deployment scripts/tooling
- **No Remix**

### Cryptography / privacy
- AES-256-GCM
- Random nonce + authentication tag
- CDS 1-of-N NIZKP
- BabyJubjub
- Poseidon
- Schnorr-style proof components
- Shamir Secret Sharing over GF(256)
- 2-of-3 authority threshold
- SHA-256 Merkle tree
- Keccak256 blockchain commitment

### Infrastructure
- Free-tier Next.js hosting
- Free-tier cloud PostgreSQL
- Public EVM testnet
- GitHub
- Gmail SMTP

Exact providers must be checked for current free-tier limits before selection.

## 4. Roles

### Admin
Creates elections, adds candidates, imports eligible voters, locks configuration, activates/closes elections. No public Create Admin registration.

### Voter
Registers with Student ID, PSG email, and password. Must use `@psgtech.ac.in`, verify email, and appear in the election eligibility list.

### Authority
Three individual accounts. 2-of-3 quorum for tally authorization.

### Observer
Inspects election status, audit information, blockchain information, chain integrity, and public verification information.

## 5. Voter Journey

```text
Public VoteChain URL
       ↓
Register
       ↓
Student ID + @psgtech.ac.in + password
       ↓
Verification email
       ↓
Click link
       ↓
emailVerified = true
       ↓
Election eligibility check
       ↓
Login
       ↓
Select candidate
       ↓
ZK proof
       ↓
Encrypted ballot
       ↓
Blockchain transaction
       ↓
Receipt
       ↓
Public verification
```

# 6. Phase Plan

## Phase 0 — Local Safety Checkpoint

### Goal
Create a rollback point before online changes.

### Tasks
- Inspect Git status.
- Confirm local version works.
- Run automated tests.
- Run real E2E.
- Run offline recovery test.
- Run production build.
- Check `.gitignore`.
- Confirm secrets are not committed.
- Commit/push working version to GitHub.

### Tests

```bash
npm test
npm run build
npx tsx scripts/verify-real-e2e.ts
npx tsx scripts/verify-offline-recovery.ts
```

### STOP
Report tests, build, E2E, offline recovery, secret check, Git checkpoint, problems, and recommendation. Do not continue automatically.

---

## Phase 1 — Real Registration + Email Verification

### Goal
Turn the already-tested email flow into actual voter registration.

Use `votechain.verify@gmail.com`.

### Implement
- Registration form
- Student ID
- `@psgtech.ac.in` validation
- Random verification token
- Secure token storage
- Expiry
- Single-use token
- Verification endpoint
- `emailVerified`
- Resend verification
- Secure password hashing
- Error handling

### Tests
- Valid registration
- Invalid domain
- Duplicate email
- Duplicate Student ID
- Email delivery
- Valid verification
- Expired token
- Reused token
- Resend
- Unverified login blocked
- Verified login allowed
- Wrong password blocked

### STOP
Report all results. Do not start Phase 2.

---

## Phase 2 — Class Eligibility

### Goal
Only officially eligible students can participate.

Example:

```csv
student_id,email
24n236,24n236@psgtech.ac.in
24n237,24n237@psgtech.ac.in
24n238,24n238@psgtech.ac.in
```

Flow:

```text
@psgtech.ac.in
+
verified email
+
email in this election's eligibility list
=
eligible voter
```

### Tasks
- Admin CSV upload
- Election-specific eligibility
- Validation
- Duplicate handling
- Secure storage
- Keep real class list out of GitHub

### Tests
Eligible allowed; non-eligible blocked; wrong email/ID blocked; invalid CSV blocked; duplicate entries handled; election-specific lists work.

### STOP
Report and stop.

---

## Phase 3 — One Vote Per Election + Authentication

### Participation model

```text
ElectionVoterParticipation
electionId
voterId
votedAt
```

Unique constraint:

```text
(electionId, voterId)
```

Expected:
- Election 1 + Voter A → first vote allowed
- Election 1 + Voter A → second vote blocked
- Election 2 + Voter A → allowed

### Tests
- Duplicate vote
- Another election
- Unverified account
- Non-eligible account
- Wrong role
- Unauthorized dashboard/API access
- Session/cookie behavior

### STOP
Report and stop.

---

## Phase 4 — Cloud PostgreSQL

### Goal
Replace local PostgreSQL with a suitable free-tier cloud PostgreSQL provider.

### Tasks
- Select provider after checking current free tier
- Create database
- Configure production `DATABASE_URL`
- Run Prisma migrations
- Seed only required system/demo data
- Test database connectivity
- Test registration, login, elections, eligibility, voting

Never commit production database credentials.

### STOP
Report provider, connectivity, migrations, tests, limits, problems. Stop.

---

## Phase 5 — Deploy Next.js Website

### Goal
Make VoteChain publicly accessible.

Use suitable free-tier hosting.

Example URL:

```text
https://votechain-xxxxx.<provider-domain>
```

### Tasks
- Connect GitHub repository
- Configure build
- Configure production environment
- Deploy
- Verify production build
- Verify public URL

### Test from
- Main computer
- Second computer
- Phone
- Different network/mobile hotspot

Test homepage, registration, login, email verification, voter, admin, authority, observer, and API requests.

### STOP
Report URL, build, tests, errors, provider limits. Stop.

---

## Phase 6 — HTTPS + Production Secrets

### Environment variables

```text
DATABASE_URL
SESSION_SECRET
BALLOT_ENCRYPTION_KEY
EMAIL_USER
EMAIL_APP_PASSWORD
VOTECHAIN_CONTRACT_ADDRESS
ETHEREUM_RPC_URL
```

### Requirements
- Secrets only in hosting environment
- No secrets in GitHub
- No secrets in client bundle
- HTTPS
- Secure HTTP-only cookies
- Appropriate SameSite settings
- CSRF protection where applicable
- CSP where appropriate

### Tests
Login, cookies, registration, email verification, APIs, production build, secret-exposure checks.

### STOP
Report security checks and stop.

---

## Phase 7 — Public Blockchain Testnet

### Goal

Replace:

```text
VoteChain → Ganache localhost:8545
```

with:

```text
VoteChain Online → Public EVM Testnet
```

### Tasks
1. Select suitable current testnet.
2. Create dedicated project/deployment wallet.
3. Obtain RPC access.
4. Obtain testnet funds if required.
5. Configure RPC securely.
6. Deploy `VoteChainLedger.sol`.
7. Save contract address.
8. Configure `ETHEREUM_RPC_URL`.
9. Configure `VOTECHAIN_CONTRACT_ADDRESS`.
10. Verify deployment.

### Rules
- Use automated project deployment tooling.
- **Do not use Remix.**
- Do not reuse Ganache contract address.
- Never expose the deployment private key.

### Tests
- Contract exists
- Contract responds
- Commitment works
- Duplicate protection works
- Events emitted
- Finalization works
- Merkle root handling works
- Receipt available

### STOP
Report testnet, chain ID, deployment transaction, contract address, tests, and problems. Never print secrets. Stop.

---

## Phase 8 — Connect VoteChain to Testnet

### Goal

```text
Student
  ↓
Public VoteChain
  ├── Cloud PostgreSQL
  └── Public Testnet
          ↓
    VoteChainLedger.sol
```

### Vote flow

```text
Candidate
   ↓
ZK proof
   ↓
AES-256-GCM encryption
   ↓
Blockchain commitment
   ↓
Testnet transaction
   ↓
Confirmation
   ↓
Receipt
```

### Tests
- Valid vote
- ZK proof
- Encryption
- Commitment
- Testnet transaction
- Confirmation
- TX hash
- Block number
- Receipt
- Duplicate protection
- Public verification

### STOP
Report and stop.

---

## Phase 9 — Threshold Authorities

Preserve:

```text
Authority 1 → Share 1
Authority 2 → Share 2
Authority 3 → Share 3

Any 2 → Tally quorum
```

### Tests
- One authority alone → tally blocked
- Any single authority → blocked
- Two valid authorities → tally allowed
- Unauthorized users → blocked
- Individual authority accounts verified

### STOP
Report and stop.

---

## Phase 10 — Full Online E2E

Run from a different computer/network:

```text
1. Open public URL
2. Register
3. Receive PSG Tech email
4. Verify email
5. Pass eligibility
6. Login
7. Vote
8. Generate ZK proof
9. Encrypt ballot
10. Submit blockchain transaction
11. Receive receipt
12. Try second vote → BLOCKED
13. Admin closes election
14. Authority 1 approves
15. Authority 2 approves
16. Tally
17. Generate Merkle root
18. Public verification
19. Observer audit
```

Every step must be reported PASS/FAIL.

### STOP
Do not proceed automatically.

---

## Phase 11 — Security Testing

### Authentication
- Wrong password → blocked
- Unverified email → blocked
- Expired token → blocked
- Reused token → blocked
- Wrong role → blocked

### Eligibility
- Non-eligible → blocked
- Eligible → allowed
- Wrong election → blocked
- Duplicate participation → blocked

### Voting
- Valid vote → accepted
- Second vote → blocked
- Closed election → blocked
- Invalid proof → blocked
- Replay → blocked

### Roles
- Voter → Admin blocked
- Voter → Authority blocked
- Observer → Admin blocked
- Observer → Authority blocked
- Authority → Admin blocked

### Privacy
Confirm `ElectionVote` does not contain:
- voterId
- email
- studentId

### Blockchain
Test duplicate commitments, invalid transactions, wrong contract, and blockchain unavailability.

### STOP
Produce security report and stop.

---

## Phase 12 — Capacity / Load Testing

### Goal
Validate the approximately 100-voter class target.

Test where supported by selected free tiers:

```text
10 concurrent users
25 concurrent users
50 concurrent users
100 concurrent users
```

Measure:
- Page response
- Login
- Registration
- Email verification
- Voting API
- Database errors
- Blockchain handling
- Timeouts
- Rate limits
- Hosting limits
- Database limits

100 total voters is different from 100 simultaneous clicks; test realistic class traffic plus controlled concurrency.

### STOP
Report measured results and free-tier limitations. Stop.

---

## Phase 13 — Offline Recovery Demonstration

Only after normal online voting works.

```text
Network available
   ↓
Prepare ballot
   ↓
Network failure
   ↓
Queue encrypted ballot + ZK proof
   ↓
Network restored
   ↓
Synchronize
   ↓
Blockchain transaction
   ↓
Receipt
```

Document this as a controlled prototype demonstration, not production-grade offline election security.

### STOP
Report results and stop.

---

## Phase 14 — Final Class Election Simulation

### Admin

```text
Login
→ Create election
→ Add candidates
→ Upload class voter list
→ Lock configuration
→ Activate
```

### Students

```text
Open public website
→ Register
→ Receive email
→ Verify
→ Login
→ Vote
→ Receive receipt
```

### Duplicate
Second vote → BLOCKED

### Authorities
Authority 1 + Authority 2 → 2-of-3 quorum → Tally

### Observer
Inspect election → blockchain/audit → integrity

### Public
Receipt → `/verify` → ballot inclusion verification

### STOP
Final demonstration checkpoint.

---

# 7. Final System Audit

## Infrastructure
- [ ] Public website
- [ ] HTTPS
- [ ] Cloud PostgreSQL
- [ ] Public testnet
- [ ] VoteChainLedger.sol deployed
- [ ] Correct contract address

## Registration
- [ ] PSG domain validation
- [ ] Email verification
- [ ] Token expiry
- [ ] Single-use token
- [ ] Resend
- [ ] Password hashing
- [ ] Eligibility

## Voting
- [ ] Election creation
- [ ] Candidate management
- [ ] ZK proof
- [ ] Encryption
- [ ] One vote per election
- [ ] Blockchain transaction
- [ ] Receipt

## Verification
- [ ] Transaction verification
- [ ] Merkle root
- [ ] Public verification
- [ ] Observer dashboard
- [ ] Audit information

## Authorities
- [ ] 2-of-3 threshold
- [ ] Tally
- [ ] Unauthorized actions blocked

## Security
- [ ] No secrets in GitHub
- [ ] No secrets in client bundle
- [ ] No voter identity in anonymous ballot
- [ ] Invalid requests blocked
- [ ] Replay blocked
- [ ] Duplicate vote blocked

## Reliability
- [ ] Automated tests
- [ ] Production build
- [ ] Online E2E
- [ ] Capacity test
- [ ] Offline recovery demonstration

# 8. Antigravity Rules

For every phase:

1. Inspect relevant existing code before changing it.
2. Implement only the current phase and necessary dependencies.
3. Preserve existing working functionality.
4. Run phase-specific tests.
5. Do not invent or assume successful test results.
6. Never expose or commit secrets.
7. If a test fails, report it honestly and do not mark the phase complete.
8. **STOP after the phase.**
9. Do not automatically start the next phase.
10. Wait for project-owner approval.

## Required phase report

```text
========================================
VOTECHAIN PHASE X REPORT
========================================

Phase:
Status: COMPLETE / NOT COMPLETE

Changes made:
- ...

Tests executed:
- ...

Test results:
- PASS / FAIL

Build:
- PASS / FAIL

Security checks:
- PASS / FAIL

Files changed:
- ...

Environment/deployment changes:
- ...

Known issues:
- ...

Free-tier/provider limitations:
- ...

Manual actions required:
- ...

Recommendation:
- PROCEED
  OR
- FIX BEFORE PROCEEDING

STOPPING NOW — WAITING FOR REVIEW
========================================
```

# 9. Free Deployment Strategy

Target ₹0 / $0 where practical.

Potential components:
- GitHub
- Free-tier Next.js hosting
- Free-tier PostgreSQL
- Public blockchain testnet
- Testnet faucet
- Gmail verification

Free-tier limits and requirements can change. Before choosing a provider, verify current:
- Pricing
- Storage
- Compute
- Bandwidth
- Connection limits
- Sleep/cold-start behavior
- Rate limits
- Billing requirements

Do not upgrade to a paid service without explicit project-owner approval.

# 10. Definition of Online-Demo Complete

The online version is ready when another computer/network can successfully use:

- Public website
- Registration
- `@psgtech.ac.in` validation
- Real email verification
- Election eligibility
- Login
- Role authorization
- Admin election creation
- Eligible-voter import
- Voting
- ZK proof
- Encryption
- Public blockchain transaction
- Receipt
- Duplicate-vote blocking
- 2-of-3 authority quorum
- Tally
- Merkle root
- Public verification
- Observer dashboard
- Offline recovery demonstration
- No exposed secrets
- Production build
- Automated tests
- Capacity testing appropriate for approximately 100 voters

# 11. Important Limitations

VoteChain remains an educational/research prototype.

Do not claim it guarantees:
- Perfect voter identity
- Perfect anonymity
- Protection against compromised voter devices
- Protection against compromised email accounts
- Coercion resistance
- Production election security
- Government-election certification

Email verification proves control of an email account; it does not independently prove physical identity.

Offline mode is a controlled prototype demonstration, not production-grade offline election security.

# 12. Execution Workflow

```text
PHASE
  ↓
ANTIGRAVITY IMPLEMENTS
  ↓
PHASE TESTS
  ↓
ANTIGRAVITY REPORT
  ↓
STOP
  ↓
PROJECT OWNER / REVIEW
  ↓
APPROVE
  ↓
NEXT PHASE
```

This phase-by-phase approach is mandatory because it makes failures easier to isolate and protects the working local version.

# 13. Immediate Starting Point

If the local version is already safely committed to GitHub, begin with:

**PHASE 1 — Real Registration + Email Verification**

Use:

`votechain.verify@gmail.com`

Do not begin cloud database, hosting, or testnet migration in the Phase 1 implementation.

Complete Phase 1, test it, produce the required report, and STOP for review.
