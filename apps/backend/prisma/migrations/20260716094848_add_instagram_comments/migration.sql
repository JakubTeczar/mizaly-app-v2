-- CreateTable
CREATE TABLE "ScrapedInstagramComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorId" TEXT,
    "authorVerified" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT NOT NULL,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "ScrapedInstagramComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScrapedInstagramComment_postId_idx" ON "ScrapedInstagramComment"("postId");

-- AddForeignKey
ALTER TABLE "ScrapedInstagramComment" ADD CONSTRAINT "ScrapedInstagramComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ScrapedInstagramPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
