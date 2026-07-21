-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "closingSlideBackgroundUrl",
DROP COLUMN "closingSlideBottomText",
DROP COLUMN "closingSlideTopText",
ADD COLUMN     "closingSlideTemplate" JSONB;

