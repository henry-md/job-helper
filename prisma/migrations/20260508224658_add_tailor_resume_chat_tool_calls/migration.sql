-- AlterTable
ALTER TABLE "TailorResumeChatMessage" ADD COLUMN     "toolCalls" JSONB NOT NULL DEFAULT '[]';
