-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "JobApplication_userId_archivedAt_idx" ON "JobApplication"("userId", "archivedAt");
