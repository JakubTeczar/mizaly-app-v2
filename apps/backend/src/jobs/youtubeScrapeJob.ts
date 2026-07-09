// Background job: every day, for each watched YouTube channel (see
// WatchedYoutubeChannel, managed from the Inspiracje > YouTube tab), fetch its
// 3 latest videos with full metadata, transcript and top comments via yt-dlp
// (src/integrations/youtube.ts) and upsert into ScrapedYoutubeVideo /
// ScrapedYoutubeComment. No AI analysis runs here - that happens on demand
// per video (see routes/youtubeVideos.ts "analyze" endpoint) since it depends
// on which of the three actions the user picks.
//
// Scheduling mirrors jobs/inspirationScrapeJob.ts: staleness-based rather
// than a fixed cron expression, so it survives restarts without double-running.

import { prisma } from "../lib/prisma";
import { fetchVideoDetails, listRecentVideos } from "../integrations/youtube";

const SCRAPE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const VIDEOS_PER_CHANNEL = 3;

let isRunning = false;

export async function runYoutubeScrapeJob(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  console.log("[youtube-job] Starting YouTube scrape...");
  try {
    const channels = await prisma.watchedYoutubeChannel.findMany();
    for (const channel of channels) {
      try {
        const videos = await listRecentVideos(channel.handle, VIDEOS_PER_CHANNEL);
        for (const video of videos) {
          try {
            const details = await fetchVideoDetails(video.id);
            await prisma.scrapedYoutubeVideo.upsert({
              where: { id: details.id },
              update: {
                title: details.title,
                thumbnailUrl: details.thumbnailUrl,
                viewCount: details.viewCount,
                likeCount: details.likeCount,
                commentCount: details.commentCount,
                durationSec: details.durationSec,
                transcript: details.transcript,
                publishedAt: details.publishedAt,
                scrapedAt: new Date(),
              },
              create: {
                id: details.id,
                channelHandle: channel.handle,
                title: details.title,
                thumbnailUrl: details.thumbnailUrl,
                viewCount: details.viewCount,
                likeCount: details.likeCount,
                commentCount: details.commentCount,
                durationSec: details.durationSec,
                transcript: details.transcript,
                publishedAt: details.publishedAt,
              },
            });

            await prisma.scrapedYoutubeComment.deleteMany({ where: { videoId: details.id } });
            if (details.comments.length > 0) {
              await prisma.scrapedYoutubeComment.createMany({
                data: details.comments.map((c) => ({
                  id: c.id,
                  videoId: details.id,
                  author: c.author,
                  text: c.text,
                  likeCount: c.likeCount,
                  postedAt: c.postedAt,
                })),
                skipDuplicates: true,
              });
            }
          } catch (err) {
            console.error(`[youtube-job] Failed to scrape video ${video.id}:`, err);
          }
        }
      } catch (err) {
        console.error(`[youtube-job] Failed to list videos for channel @${channel.handle}:`, err);
      }
    }
    console.log("[youtube-job] Scrape finished.");
  } catch (err) {
    console.error("[youtube-job] Scrape failed:", err);
  } finally {
    isRunning = false;
  }
}

async function runIfStale(): Promise<void> {
  const newest = await prisma.scrapedYoutubeVideo.findFirst({ orderBy: { scrapedAt: "desc" } });
  if (!newest || Date.now() - newest.scrapedAt.getTime() > SCRAPE_INTERVAL_MS) {
    await runYoutubeScrapeJob();
  }
}

export function startYoutubeScrapeScheduler(): void {
  setTimeout(() => {
    runIfStale().catch((err) => console.error("[youtube-job] Initial check failed:", err));
  }, 15_000);

  setInterval(() => {
    runIfStale().catch((err) => console.error("[youtube-job] Periodic check failed:", err));
  }, CHECK_EVERY_MS);
}
