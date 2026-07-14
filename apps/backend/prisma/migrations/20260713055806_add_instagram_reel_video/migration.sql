-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "carouselSlides" JSONB;

-- AlterTable
ALTER TABLE "ScrapedInstagramPost" ADD COLUMN     "isReel" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "videoUrl" TEXT;
