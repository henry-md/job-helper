-- CreateEnum
CREATE TYPE "TailorResumeChatRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "TailorResumeChatThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "pageTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TailorResumeChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TailorResumeChatMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" "TailorResumeChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TailorResumeChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TailorResumeChatThread_userId_updatedAt_idx" ON "TailorResumeChatThread"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "TailorResumeChatThread_userId_urlHash_key" ON "TailorResumeChatThread"("userId", "urlHash");

-- CreateIndex
CREATE INDEX "TailorResumeChatMessage_threadId_createdAt_idx" ON "TailorResumeChatMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "TailorResumeChatMessage_userId_createdAt_idx" ON "TailorResumeChatMessage"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "TailorResumeChatThread" ADD CONSTRAINT "TailorResumeChatThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TailorResumeChatMessage" ADD CONSTRAINT "TailorResumeChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "TailorResumeChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TailorResumeChatMessage" ADD CONSTRAINT "TailorResumeChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
