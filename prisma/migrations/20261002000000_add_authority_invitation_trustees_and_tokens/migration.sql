-- CreateEnum
CREATE TYPE "TokenType" AS ENUM ('EMAIL_VERIFICATION', 'AUTHORITY_INVITATION', 'PASSWORD_RESET');

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'INVITED';

-- AlterTable
ALTER TABLE "Election" ADD COLUMN     "observerAccessCodeHash" TEXT;

-- AlterTable
ALTER TABLE "VerificationToken" ADD COLUMN     "type" "TokenType" NOT NULL DEFAULT 'EMAIL_VERIFICATION';

-- CreateTable
CREATE TABLE "ElectionTrustee" (
    "id" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElectionTrustee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ElectionTrustee_authorityId_idx" ON "ElectionTrustee"("authorityId");

-- CreateIndex
CREATE INDEX "ElectionTrustee_electionId_idx" ON "ElectionTrustee"("electionId");

-- CreateIndex
CREATE UNIQUE INDEX "ElectionTrustee_electionId_authorityId_key" ON "ElectionTrustee"("electionId", "authorityId");

-- CreateIndex
CREATE UNIQUE INDEX "ElectionTrustee_electionId_slotIndex_key" ON "ElectionTrustee"("electionId", "slotIndex");

-- CreateIndex
CREATE INDEX "VerificationToken_type_expiresAt_idx" ON "VerificationToken"("type", "expiresAt");

-- AddForeignKey
ALTER TABLE "ElectionTrustee" ADD CONSTRAINT "ElectionTrustee_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionTrustee" ADD CONSTRAINT "ElectionTrustee_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
