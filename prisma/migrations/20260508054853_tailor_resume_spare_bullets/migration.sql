-- CreateEnum
CREATE TYPE "TailorResumeKeywordKind" AS ENUM ('HARD', 'SOFT', 'NON_SKILL');

-- CreateTable
CREATE TABLE "TailorResumeKeywordClassification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "kind" "TailorResumeKeywordKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TailorResumeKeywordClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TailorResumeSkill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "listInSkillsOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TailorResumeSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TailorResumeSpareBullet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "replacesQuote" TEXT,
    "resumeExperienceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TailorResumeSpareBullet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TailorResumeSpareBulletSkill" (
    "spareBulletId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TailorResumeSpareBulletSkill_pkey" PRIMARY KEY ("spareBulletId","skillId")
);

-- CreateIndex
CREATE INDEX "TailorResumeKeywordClassification_userId_kind_updatedAt_idx" ON "TailorResumeKeywordClassification"("userId", "kind", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "TailorResumeKeywordClassification_userId_normalizedName_key" ON "TailorResumeKeywordClassification"("userId", "normalizedName");

-- CreateIndex
CREATE INDEX "TailorResumeSkill_userId_updatedAt_idx" ON "TailorResumeSkill"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "TailorResumeSkill_userId_normalizedName_key" ON "TailorResumeSkill"("userId", "normalizedName");

-- CreateIndex
CREATE INDEX "TailorResumeSpareBullet_userId_resumeExperienceId_updatedAt_idx" ON "TailorResumeSpareBullet"("userId", "resumeExperienceId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "TailorResumeSpareBullet_userId_updatedAt_idx" ON "TailorResumeSpareBullet"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "TailorResumeSpareBulletSkill_skillId_idx" ON "TailorResumeSpareBulletSkill"("skillId");

-- AddForeignKey
ALTER TABLE "TailorResumeKeywordClassification" ADD CONSTRAINT "TailorResumeKeywordClassification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TailorResumeSkill" ADD CONSTRAINT "TailorResumeSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TailorResumeSpareBullet" ADD CONSTRAINT "TailorResumeSpareBullet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TailorResumeSpareBulletSkill" ADD CONSTRAINT "TailorResumeSpareBulletSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "TailorResumeSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TailorResumeSpareBulletSkill" ADD CONSTRAINT "TailorResumeSpareBulletSkill_spareBulletId_fkey" FOREIGN KEY ("spareBulletId") REFERENCES "TailorResumeSpareBullet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
