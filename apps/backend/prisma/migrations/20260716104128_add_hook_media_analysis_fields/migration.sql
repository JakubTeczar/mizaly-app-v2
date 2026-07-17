-- AlterTable
ALTER TABLE "ScrapedInstagramPost" ADD COLUMN     "transcript" JSONB,
ADD COLUMN     "visualDescription" TEXT,
ADD COLUMN     "visualText" TEXT;
