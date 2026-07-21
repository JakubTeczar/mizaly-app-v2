-- CreateTable
CREATE TABLE "CreatorAuditAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScrapedAt" TIMESTAMP(3),

    CONSTRAINT "CreatorAuditAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorAuditPost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "instagramPostId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "videoUrl" TEXT,
    "isReel" BOOLEAN NOT NULL DEFAULT false,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "commentsCount" INTEGER NOT NULL DEFAULT 0,
    "videoViewCount" INTEGER,
    "postedAt" TIMESTAMP(3),
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transcript" JSONB,
    "visualDescription" TEXT,
    "visualText" TEXT,
    "hookText" TEXT,
    "hookVisual" TEXT,
    "cta" TEXT,
    "ctaDetail" TEXT,
    "topic" TEXT,
    "format" TEXT,

    CONSTRAINT "CreatorAuditPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorAuditAccount_organizationId_key" ON "CreatorAuditAccount"("organizationId");

-- CreateIndex
CREATE INDEX "CreatorAuditPost_organizationId_idx" ON "CreatorAuditPost"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorAuditPost_organizationId_username_postedAt_key" ON "CreatorAuditPost"("organizationId", "username", "postedAt");

-- AddForeignKey
ALTER TABLE "CreatorAuditAccount" ADD CONSTRAINT "CreatorAuditAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorAuditPost" ADD CONSTRAINT "CreatorAuditPost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
