-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('VOTER', 'ADMIN', 'OBSERVER', 'AUTHORITY');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ElectionStatus" AS ENUM ('DRAFT', 'UPCOMING', 'ACTIVE', 'CLOSED', 'RESULTS_PUBLISHED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "voterId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VOTER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Election" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" "ElectionStatus" NOT NULL DEFAULT 'DRAFT',
    "candidatesLocked" BOOLEAN NOT NULL DEFAULT false,
    "eligibleVoterIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredAuthorityApprovals" INTEGER NOT NULL DEFAULT 2,
    "encryptedMasterKey" TEXT,
    "keyCommitment" TEXT,
    "resultsPublishedAt" TIMESTAMP(3),
    "resultsDigest" TEXT,
    "merkleRoot" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Election_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectionCandidate" (
    "id" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElectionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectionVote" (
    "id" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "voterId" TEXT,
    "candidateId" TEXT,
    "receiptId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "encryptedBallot" TEXT NOT NULL,
    "ballotNonce" TEXT NOT NULL,
    "ballotAuthTag" TEXT NOT NULL,
    "ballotProof" TEXT NOT NULL,
    "zkProof" TEXT,
    "blockNumber" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElectionVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectionVoterParticipation" (
    "id" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElectionVoterParticipation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectionBlockchainBlock" (
    "id" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "previousHash" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElectionBlockchainBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectionAuthorityApproval" (
    "id" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "keyShare" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElectionAuthorityApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorReference" TEXT NOT NULL,
    "electionId" TEXT,
    "details" TEXT NOT NULL DEFAULT '',
    "eventHash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_voterId_key" ON "User"("voterId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE INDEX "Election_status_startTime_idx" ON "Election"("status", "startTime");

-- CreateIndex
CREATE INDEX "Election_createdById_createdAt_idx" ON "Election"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "ElectionCandidate_electionId_sortOrder_idx" ON "ElectionCandidate"("electionId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ElectionCandidate_electionId_name_key" ON "ElectionCandidate"("electionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ElectionVote_receiptId_key" ON "ElectionVote"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "ElectionVote_txHash_key" ON "ElectionVote"("txHash");

-- CreateIndex
CREATE INDEX "ElectionVote_electionId_submittedAt_idx" ON "ElectionVote"("electionId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ElectionVote_electionId_voterId_key" ON "ElectionVote"("electionId", "voterId");

-- CreateIndex
CREATE INDEX "ElectionVoterParticipation_electionId_createdAt_idx" ON "ElectionVoterParticipation"("electionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ElectionVoterParticipation_electionId_voterId_key" ON "ElectionVoterParticipation"("electionId", "voterId");

-- CreateIndex
CREATE UNIQUE INDEX "ElectionBlockchainBlock_hash_key" ON "ElectionBlockchainBlock"("hash");

-- CreateIndex
CREATE INDEX "ElectionBlockchainBlock_electionId_index_idx" ON "ElectionBlockchainBlock"("electionId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "ElectionBlockchainBlock_electionId_index_key" ON "ElectionBlockchainBlock"("electionId", "index");

-- CreateIndex
CREATE INDEX "ElectionAuthorityApproval_electionId_approved_idx" ON "ElectionAuthorityApproval"("electionId", "approved");

-- CreateIndex
CREATE UNIQUE INDEX "ElectionAuthorityApproval_electionId_authorityId_key" ON "ElectionAuthorityApproval"("electionId", "authorityId");

-- CreateIndex
CREATE INDEX "AuditLog_electionId_timestamp_idx" ON "AuditLog"("electionId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_eventType_idx" ON "AuditLog"("eventType");

-- AddForeignKey
ALTER TABLE "Election" ADD CONSTRAINT "Election_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionCandidate" ADD CONSTRAINT "ElectionCandidate_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionVote" ADD CONSTRAINT "ElectionVote_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionVote" ADD CONSTRAINT "ElectionVote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionVote" ADD CONSTRAINT "ElectionVote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ElectionCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionVoterParticipation" ADD CONSTRAINT "ElectionVoterParticipation_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionVoterParticipation" ADD CONSTRAINT "ElectionVoterParticipation_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionBlockchainBlock" ADD CONSTRAINT "ElectionBlockchainBlock_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionAuthorityApproval" ADD CONSTRAINT "ElectionAuthorityApproval_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;
