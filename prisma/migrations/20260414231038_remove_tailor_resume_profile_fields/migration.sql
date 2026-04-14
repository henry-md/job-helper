/*
  Warnings:

  - You are about to drop the column `resumeMimeType` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `resumeOriginalFilename` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `resumeSizeBytes` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `resumeStoragePath` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `resumeUpdatedAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `tailorJobDescription` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "resumeMimeType",
DROP COLUMN "resumeOriginalFilename",
DROP COLUMN "resumeSizeBytes",
DROP COLUMN "resumeStoragePath",
DROP COLUMN "resumeUpdatedAt",
DROP COLUMN "tailorJobDescription";
