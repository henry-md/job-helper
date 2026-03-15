/*
  Warnings:

  - You are about to drop the column `sourceScreenshotId` on the `JobApplication` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "JobApplicationScreenshot" ADD COLUMN     "applicationId" TEXT;

-- Backfill the new one-to-many relation from the legacy single screenshot link.
UPDATE "JobApplicationScreenshot" AS "screenshot"
SET "applicationId" = "application"."id"
FROM "JobApplication" AS "application"
WHERE "application"."sourceScreenshotId" = "screenshot"."id";

-- DropForeignKey
ALTER TABLE "JobApplication" DROP CONSTRAINT "JobApplication_sourceScreenshotId_fkey";

-- DropIndex
DROP INDEX "JobApplication_sourceScreenshotId_key";

-- AlterTable
ALTER TABLE "JobApplication" DROP COLUMN "sourceScreenshotId";

-- CreateIndex
CREATE INDEX "JobApplicationScreenshot_applicationId_createdAt_idx" ON "JobApplicationScreenshot"("applicationId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "JobApplicationScreenshot" ADD CONSTRAINT "JobApplicationScreenshot_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
