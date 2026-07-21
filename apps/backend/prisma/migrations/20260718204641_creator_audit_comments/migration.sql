-- CreateTable
CREATE TABLE "CreatorAuditComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorId" TEXT,
    "authorVerified" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT NOT NULL,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "CreatorAuditComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreatorAuditComment_postId_idx" ON "CreatorAuditComment"("postId");

-- AddForeignKey
ALTER TABLE "CreatorAuditComment" ADD CONSTRAINT "CreatorAuditComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CreatorAuditPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
