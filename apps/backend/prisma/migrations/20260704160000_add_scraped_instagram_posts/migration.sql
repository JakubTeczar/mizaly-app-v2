-- CreateTable
CREATE TABLE "ScrapedInstagramPost" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "commentsCount" INTEGER NOT NULL DEFAULT 0,
    "videoViewCount" INTEGER,
    "postedAt" TIMESTAMP(3),
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapedInstagramPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScrapedInstagramPost_username_idx" ON "ScrapedInstagramPost"("username");

-- CreateTable
CREATE TABLE "InspirationAnalysis" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InspirationAnalysis_pkey" PRIMARY KEY ("id")
);
