-- CreateTable
CREATE TABLE "CommentClusterSet" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "clusters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentClusterSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommentClusterSet_source_createdAt_idx" ON "CommentClusterSet"("source", "createdAt");
