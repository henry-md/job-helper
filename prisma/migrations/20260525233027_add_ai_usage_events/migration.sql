-- CreateEnum
CREATE TYPE "AiUsageProvider" AS ENUM ('OPENAI', 'ANTHROPIC');

-- CreateEnum
CREATE TYPE "AiUsageStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiUsageSubjectStatus" AS ENUM ('UNARCHIVED', 'ARCHIVED', 'DELETED');

-- CreateTable
CREATE TABLE "AiUsageEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT,
    "tailorResumeRunId" TEXT,
    "tailoredResumeId" TEXT,
    "jobUrl" TEXT,
    "jobUrlHash" TEXT,
    "subjectStatus" "AiUsageSubjectStatus" NOT NULL DEFAULT 'UNARCHIVED',
    "provider" "AiUsageProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "stepNumber" INTEGER,
    "stepLabel" TEXT,
    "attempt" INTEGER,
    "round" INTEGER,
    "requestStartedAt" TIMESTAMP(3) NOT NULL,
    "requestFinishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "status" "AiUsageStatus" NOT NULL,
    "error" TEXT,
    "providerResponseId" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationInputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "inputCostUsdMicros" BIGINT NOT NULL DEFAULT 0,
    "cachedInputCostUsdMicros" BIGINT NOT NULL DEFAULT 0,
    "cacheCreationCostUsdMicros" BIGINT NOT NULL DEFAULT 0,
    "outputCostUsdMicros" BIGINT NOT NULL DEFAULT 0,
    "totalCostUsdMicros" BIGINT NOT NULL DEFAULT 0,
    "pricingSnapshot" JSONB NOT NULL DEFAULT '{}',
    "rawUsage" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsageEvent_userId_requestStartedAt_idx" ON "AiUsageEvent"("userId", "requestStartedAt" DESC);

-- CreateIndex
CREATE INDEX "AiUsageEvent_userId_subjectStatus_requestStartedAt_idx" ON "AiUsageEvent"("userId", "subjectStatus", "requestStartedAt" DESC);

-- CreateIndex
CREATE INDEX "AiUsageEvent_userId_jobUrlHash_requestStartedAt_idx" ON "AiUsageEvent"("userId", "jobUrlHash", "requestStartedAt" DESC);

-- CreateIndex
CREATE INDEX "AiUsageEvent_tailorResumeRunId_requestStartedAt_idx" ON "AiUsageEvent"("tailorResumeRunId", "requestStartedAt" DESC);

-- CreateIndex
CREATE INDEX "AiUsageEvent_tailoredResumeId_requestStartedAt_idx" ON "AiUsageEvent"("tailoredResumeId", "requestStartedAt" DESC);

-- AddForeignKey
ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
