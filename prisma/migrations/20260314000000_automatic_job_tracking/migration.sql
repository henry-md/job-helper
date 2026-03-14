-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplicationScreenshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "extractionStatus" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "extractionModel" TEXT,
    "extractionError" TEXT,
    "extractedPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobApplicationScreenshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_userId_normalizedName_key" ON "Company"("userId", "normalizedName");

-- AlterTable
ALTER TABLE "JobApplication"
    ADD COLUMN "companyId" TEXT,
    ADD COLUMN "hasReferral" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "jobDescription" TEXT,
    ADD COLUMN "sourceScreenshotId" TEXT,
    ADD COLUMN "userId" TEXT;

-- Backfill user ownership for existing application rows.
DO $$
DECLARE
    application_count INTEGER;
    user_count INTEGER;
    fallback_user_id TEXT;
BEGIN
    SELECT COUNT(*) INTO application_count FROM "JobApplication";

    IF application_count > 0 THEN
        SELECT COUNT(*) INTO user_count FROM "User";

        IF user_count <> 1 THEN
            RAISE EXCEPTION 'Cannot backfill JobApplication.userId automatically. Expected exactly 1 existing user, found %.', user_count;
        END IF;

        SELECT "id" INTO fallback_user_id
        FROM "User"
        LIMIT 1;

        UPDATE "JobApplication"
        SET "userId" = fallback_user_id
        WHERE "userId" IS NULL;
    END IF;
END $$;

-- Materialize first-class companies from the legacy company string.
INSERT INTO "Company" ("id", "userId", "name", "normalizedName", "createdAt", "updatedAt")
SELECT DISTINCT
    CONCAT('migrated_company_', md5("userId" || ':' || lower(trim("company")))),
    "userId",
    "company",
    trim(regexp_replace(replace(lower("company"), '&', ' and '), '[^a-z0-9]+', ' ', 'g')),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "JobApplication"
WHERE "userId" IS NOT NULL
ON CONFLICT ("userId", "normalizedName") DO NOTHING;

UPDATE "JobApplication" AS "application"
SET "companyId" = "company"."id"
FROM "Company" AS "company"
WHERE "company"."userId" = "application"."userId"
  AND "company"."normalizedName" = trim(regexp_replace(replace(lower("application"."company"), '&', ' and '), '[^a-z0-9]+', ' ', 'g'));

UPDATE "JobApplication"
SET "appliedAt" = COALESCE("appliedAt", CURRENT_TIMESTAMP);

-- Tighten the new constraints after backfill.
ALTER TABLE "JobApplication"
    ALTER COLUMN "userId" SET NOT NULL,
    ALTER COLUMN "companyId" SET NOT NULL,
    ALTER COLUMN "appliedAt" SET NOT NULL,
    ALTER COLUMN "status" SET DEFAULT 'APPLIED';

ALTER TABLE "JobApplication"
    DROP COLUMN "company";

-- CreateIndex
CREATE INDEX "Company_userId_createdAt_idx" ON "Company"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "JobApplicationScreenshot_userId_createdAt_idx" ON "JobApplicationScreenshot"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "JobApplicationScreenshot_extractionStatus_idx" ON "JobApplicationScreenshot"("extractionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_sourceScreenshotId_key" ON "JobApplication"("sourceScreenshotId");

-- CreateIndex
CREATE INDEX "JobApplication_userId_status_idx" ON "JobApplication"("userId", "status");

-- CreateIndex
CREATE INDEX "JobApplication_userId_createdAt_idx" ON "JobApplication"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "JobApplication_companyId_createdAt_idx" ON "JobApplication"("companyId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplicationScreenshot" ADD CONSTRAINT "JobApplicationScreenshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_sourceScreenshotId_fkey" FOREIGN KEY ("sourceScreenshotId") REFERENCES "JobApplicationScreenshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
