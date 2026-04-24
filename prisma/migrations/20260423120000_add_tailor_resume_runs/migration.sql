-- CreateEnum
CREATE TYPE "TailorResumeRunStatus" AS ENUM ('RUNNING', 'NEEDS_INPUT', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN "jobUrlHash" TEXT;

-- CreateTable
CREATE TABLE "TailoredResume" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT,
    "profileRecordId" TEXT NOT NULL,
    "jobUrl" TEXT,
    "jobUrlHash" TEXT,
    "displayName" TEXT NOT NULL,
    "companyName" TEXT,
    "positionTitle" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TailoredResume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TailorResumeRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "tailoredResumeId" TEXT,
    "status" "TailorResumeRunStatus" NOT NULL DEFAULT 'RUNNING',
    "jobUrl" TEXT,
    "jobUrlHash" TEXT,
    "jobDescription" TEXT NOT NULL,
    "stepNumber" INTEGER,
    "stepCount" INTEGER,
    "stepStatus" TEXT,
    "stepSummary" TEXT,
    "stepDetail" TEXT,
    "stepAttempt" INTEGER,
    "stepRetrying" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TailorResumeRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_userId_jobUrlHash_key" ON "JobApplication"("userId", "jobUrlHash");

-- CreateIndex
CREATE UNIQUE INDEX "TailoredResume_userId_profileRecordId_key" ON "TailoredResume"("userId", "profileRecordId");

-- CreateIndex
CREATE INDEX "TailoredResume_applicationId_updatedAt_idx" ON "TailoredResume"("applicationId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "TailoredResume_userId_updatedAt_idx" ON "TailoredResume"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "TailoredResume_userId_jobUrlHash_updatedAt_idx" ON "TailoredResume"("userId", "jobUrlHash", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "TailorResumeRun_applicationId_updatedAt_idx" ON "TailorResumeRun"("applicationId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "TailorResumeRun_userId_status_updatedAt_idx" ON "TailorResumeRun"("userId", "status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "TailorResumeRun_userId_jobUrlHash_updatedAt_idx" ON "TailorResumeRun"("userId", "jobUrlHash", "updatedAt" DESC);

-- AddForeignKey
ALTER TABLE "TailoredResume" ADD CONSTRAINT "TailoredResume_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TailoredResume" ADD CONSTRAINT "TailoredResume_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TailorResumeRun" ADD CONSTRAINT "TailorResumeRun_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TailorResumeRun" ADD CONSTRAINT "TailorResumeRun_tailoredResumeId_fkey" FOREIGN KEY ("tailoredResumeId") REFERENCES "TailoredResume"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TailorResumeRun" ADD CONSTRAINT "TailorResumeRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
