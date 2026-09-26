# VoteChain

VoteChain is an educational privacy-preserving voting prototype. It combines role-based authentication, election lifecycle management, encrypted ballot metadata, a tamper-evident application ledger, Ethereum-compatible commitment transactions, authority approval, Merkle verification, public results, and QR-based verification.

This is research/demo software, not certified election software. Do not use it for a real election or expose local development services to an untrusted network.

## Current features

- PostgreSQL-backed users and elections with Prisma
- Bcrypt password hashing and signed HTTP-only sessions
- Admin, voter, observer, and authority roles
- Election lifecycle: `DRAFT` -> `UPCOMING` -> `ACTIVE` -> `CLOSED` -> `RESULTS_PUBLISHED`
- Candidate locking and eligible-voter ID enforcement
- One vote per voter per election
- AES-256-GCM encrypted ballot payloads with authenticated proof metadata
- Local append-only SHA-256 application ledger
- Ethereum-compatible `VoteChainLedger` smart contract commitments
- Real mined transaction hash and block number in vote receipts
- Authority approval threshold checks
- Merkle root and inclusion-proof utilities
- Public result and blockchain verification pages
- Browser-openable, scannable verification QR codes

## Tech stack

- Next.js 16, React 19, TypeScript
- PostgreSQL and Prisma 6
- ethers 6 and Solidity 0.8 contract compilation through `solc`
- Ganache for the reproducible local Ethereum node
- bcryptjs, qrcode, lucide-react
- Node.js 20.9 or newer

## Prerequisites

- Node.js 20.9+
- npm
- Docker Desktop for the documented PostgreSQL setup
- PowerShell on Windows, or equivalent shell commands on another OS

An Ethereum-compatible JSON-RPC endpoint is required for voting. The repository includes Ganache for local development; Anvil, Hardhat node, or another compatible endpoint can also be used.

## Installation

```powershell
Copy-Item .env.example .env
npm install
```

Edit `.env` before seeding. Use unique local values for `SESSION_SECRET`, `BALLOT_ENCRYPTION_KEY`, and `ADMIN_PASSWORD`. Never commit `.env`.

## Database setup

Start PostgreSQL with Docker:

```powershell
docker compose up -d postgres
npm run db:generate
npm run db:push
npm run db:seed
```

The schema is currently synchronized with `prisma db push`; this repository does not contain Prisma migration files. The seed command reads `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env` and stores only password hashes. Optional voter, observer, and authority accounts are created when both corresponding environment values are provided.

## Blockchain setup

Start the deterministic local Ethereum node in a second terminal:

```powershell
npm run blockchain:node
```

Set either an unlocked local account or a private key in `.env`:

```dotenv
ETHEREUM_RPC_URL="http://127.0.0.1:8545"
ETHEREUM_ACCOUNT="0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1"
# Use ETHEREUM_PRIVATE_KEY instead for a secured signer; do not commit it.
```

Deploy the contract:

```powershell
npm run blockchain:deploy
```

Copy the printed `VOTECHAIN_CONTRACT_ADDRESS` into `.env`. The deployment script compiles [VoteChainLedger.sol](contracts/VoteChainLedger.sol), deploys it, and writes a local JSON artifact that is intentionally ignored by Git. The contract stores only an election hash and ballot commitment, rejects duplicate commitments, and emits `VoteRecorded`; it does not receive voter identity or plaintext candidate choices.

## Run the application

```powershell
npm run dev
```

Open <http://localhost:3000> and sign in with the seeded administrator account. The backend is provided by Next.js route handlers; there is no separate backend server command.

For a production-style local check:

```powershell
npm run build
npm run start
```

## Tests and validation

Run the library regression suite:

```powershell
npx tsx --test src/lib/*.test.ts
```

Run linting and the production build:

```powershell
npm run lint
npm run build
```

The smart contract is compiled and deployed by `npm run blockchain:deploy`. A local Ganache run has been used to verify contract deployment and a mined commitment transaction. There is not yet a dedicated automated smart-contract test suite.

## Repository contents

- `src/`: Next.js pages, route handlers, components, and library tests
- `prisma/`: database schema and seed script
- `contracts/`: Solidity source; deployment JSON artifacts are generated locally
- `scripts/`: contract deployment tooling
- `docker-compose.yml`: local PostgreSQL service
- `VoteChain_Project_Specification.txt`: canonical project specification

## Development status and known limitations

The current implementation is a working local prototype. The Ethereum layer uses a single configured signer and a small commitment contract; it is not a decentralized validator network. Remaining work includes offline/pending transaction recovery demonstrations, signed multi-authority key management, production key custody, rate limiting, CSRF protection where applicable, secure headers, structured audit logging, migration files, end-to-end tests, and independent security review.

Never store voter passwords, plaintext choices, or personally identifying voter data on-chain. A blockchain does not guarantee a secure voter device, prevent coercion, or replace election procedures and certification.