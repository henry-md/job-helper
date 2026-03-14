-- DropIndex
DROP INDEX "JobApplication_createdAt_idx";

-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN     "onsiteDaysPerWeek" INTEGER;
