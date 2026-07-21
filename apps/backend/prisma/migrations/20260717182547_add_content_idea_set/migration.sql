-- CreateTable
CREATE TABLE "ContentIdeaSet" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ideas" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentIdeaSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentIdeaSet_source_createdAt_idx" ON "ContentIdeaSet"("source", "createdAt");
