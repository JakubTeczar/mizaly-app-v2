-- AlterTable
ALTER TABLE "InspirationAnalysis" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'instagram';

-- CreateIndex
CREATE INDEX "InspirationAnalysis_source_createdAt_idx" ON "InspirationAnalysis"("source", "createdAt");
