/*
  Warnings:

  - You are about to drop the column `email` on the `Person` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `Person` table. All the data in the column will be lost.
  - You are about to drop the column `phoneNumber` on the `Person` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Person" DROP COLUMN "email",
DROP COLUMN "notes",
DROP COLUMN "phoneNumber";

-- CreateTable
CREATE TABLE "TailorResumeLockedLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TailorResumeLockedLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TailorResumeLockedLink_userId_updatedAt_idx" ON "TailorResumeLockedLink"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "TailorResumeLockedLink_userId_key_key" ON "TailorResumeLockedLink"("userId", "key");

-- AddForeignKey
ALTER TABLE "TailorResumeLockedLink" ADD CONSTRAINT "TailorResumeLockedLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
