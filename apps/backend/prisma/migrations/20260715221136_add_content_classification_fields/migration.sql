-- AlterTable
ALTER TABLE "ScrapedInstagramPost" ADD COLUMN     "format" TEXT,
ADD COLUMN     "hook" TEXT,
ADD COLUMN     "topic" TEXT;

-- AlterTable
ALTER TABLE "ScrapedYoutubeVideo" ADD COLUMN     "format" TEXT,
ADD COLUMN     "hook" TEXT,
ADD COLUMN     "topic" TEXT;
