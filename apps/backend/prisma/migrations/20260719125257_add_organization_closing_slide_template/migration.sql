-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "closingSlideBackgroundUrl" TEXT,
ADD COLUMN     "closingSlideBottomText" TEXT,
ADD COLUMN     "closingSlideTopText" TEXT;

-- CreateTable
CREATE TABLE "ContentTransferPost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "instagramPostId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "imageUrl" TEXT,
    "videoUrl" TEXT,
    "isReel" BOOLEAN NOT NULL DEFAULT false,
    "postedAt" TIMESTAMP(3),
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentTransferPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentTransferPost_organizationId_idx" ON "ContentTransferPost"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentTransferPost_organizationId_instagramPostId_key" ON "ContentTransferPost"("organizationId", "instagramPostId");

-- AddForeignKey
ALTER TABLE "ContentTransferPost" ADD CONSTRAINT "ContentTransferPost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
