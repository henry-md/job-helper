-- CreateEnum
CREATE TYPE "TailorResumeKeywordPriority" AS ENUM ('HIGH', 'LOW');

-- AlterTable
ALTER TABLE "TailorResumeKeywordClassification" ADD COLUMN     "priority" "TailorResumeKeywordPriority";
