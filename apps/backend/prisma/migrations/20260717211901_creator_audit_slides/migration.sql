-- AlterTable
ALTER TABLE "CreatorAuditPost"
  ADD COLUMN "imageUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "slideAnalysis" JSONB,
  DROP COLUMN "imageUrl",
  DROP COLUMN "visualDescription",
  DROP COLUMN "visualText";
