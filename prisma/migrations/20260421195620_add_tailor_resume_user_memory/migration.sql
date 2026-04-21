-- CreateTable
CREATE TABLE "TailorResumeUserMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TailorResumeUserMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TailorResumeUserMemory_userId_key" ON "TailorResumeUserMemory"("userId");

-- CreateIndex
CREATE INDEX "TailorResumeUserMemory_updatedAt_idx" ON "TailorResumeUserMemory"("updatedAt" DESC);

-- AddForeignKey
ALTER TABLE "TailorResumeUserMemory" ADD CONSTRAINT "TailorResumeUserMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
