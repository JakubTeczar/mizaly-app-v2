-- CreateTable
CREATE TABLE "WatchedInstagramAccount" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchedInstagramAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchedYoutubeChannel" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchedYoutubeChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapedYoutubeVideo" (
    "id" TEXT NOT NULL,
    "channelHandle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "thumbnailUrl" TEXT NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "durationSec" INTEGER,
    "transcript" TEXT,
    "publishedAt" TIMESTAMP(3),
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapedYoutubeVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapedYoutubeComment" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "ScrapedYoutubeComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsletterEmail" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "fromName" TEXT,
    "fromAddress" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "bodyHtml" TEXT,
    "bodyText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsletterEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchedInstagramAccount_username_key" ON "WatchedInstagramAccount"("username");

-- CreateIndex
CREATE UNIQUE INDEX "WatchedYoutubeChannel_handle_key" ON "WatchedYoutubeChannel"("handle");

-- CreateIndex
CREATE INDEX "ScrapedYoutubeVideo_channelHandle_idx" ON "ScrapedYoutubeVideo"("channelHandle");

-- CreateIndex
CREATE INDEX "ScrapedYoutubeComment_videoId_idx" ON "ScrapedYoutubeComment"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterEmail_messageId_key" ON "NewsletterEmail"("messageId");

-- CreateIndex
CREATE INDEX "NewsletterEmail_receivedAt_idx" ON "NewsletterEmail"("receivedAt");

-- AddForeignKey
ALTER TABLE "ScrapedYoutubeComment" ADD CONSTRAINT "ScrapedYoutubeComment_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "ScrapedYoutubeVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
