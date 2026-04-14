-- AlterTable
ALTER TABLE "User"
ADD COLUMN "tailorJobDescription" TEXT,
ADD COLUMN "resumeOriginalFilename" TEXT,
ADD COLUMN "resumeStoragePath" TEXT,
ADD COLUMN "resumeMimeType" TEXT,
ADD COLUMN "resumeSizeBytes" INTEGER,
ADD COLUMN "resumeUpdatedAt" TIMESTAMP(3);
