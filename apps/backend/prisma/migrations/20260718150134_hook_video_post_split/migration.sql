-- AlterTable
ALTER TABLE "CreatorAuditPost"
  ADD COLUMN "hookVideo" TEXT,
  ADD COLUMN "hookVideoDetail" TEXT,
  ADD COLUMN "hookPost" TEXT,
  ADD COLUMN "hookPostDetail" TEXT,
  ADD COLUMN "ctaLocation" TEXT,
  DROP COLUMN "hookText",
  DROP COLUMN "hookVisual";
