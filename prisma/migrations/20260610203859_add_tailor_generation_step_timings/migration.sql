-- AlterTable
ALTER TABLE "TailorResumeRun" ADD COLUMN     "generationStepTimings" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "TailoredResume" ADD COLUMN     "generationStepTimings" JSONB NOT NULL DEFAULT '[]';
