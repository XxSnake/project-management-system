-- AlterTable
ALTER TABLE "Project" ADD COLUMN "noContractExpected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "fuzzyMatchStatus" TEXT;
ALTER TABLE "Project" ADD COLUMN "fuzzyMatchCandidateIds" TEXT;
ALTER TABLE "Project" ADD COLUMN "fuzzyMatchedAt" DATETIME;
ALTER TABLE "WorkLog" ADD COLUMN "acknowledgedExceptions" TEXT;
