// Background job: every day, for each watched YouTube channel (see
// WatchedYoutubeChannel, managed from the Inspiracje > YouTube tab), fetch
// new videos with full metadata, transcript and comments via yt-dlp
// (src/integrations/youtube.ts) and store them in ScrapedYoutubeVideo /
// ScrapedYoutubeComment.
//
// First run per channel (no videos stored yet) backfills up to
// BACKFILL_VIDEO_LIMIT videos - in practice, at least the last month for any
// normal posting cadence, since channels list newest-first. Every run after
// that is incremental: only the INCREMENTAL_VIDEO_LIMIT most recent videos
// are even listed, and only the ones not already in the DB get fetched -
// already-known videos are never re-fetched. That means a video's comments
// are captured once (when first discovered) and kept, not re-synced on every
// run - deliberate, since re-fetching thousands of comments daily for videos
// we've already fully captured would be wasteful and wasn't asked for.
//
// (Videos already scraped before this behavior existed, back when the job
// only kept the 3 latest per channel with a 50-comment cap, are unaffected
// by this change - they just stay as they were until re-scraped some other
// way.)
//
// Also generates a section-level AI insight analysis after each run (see
// lib/contentInsights.ts), same "InspirationAnalysis" table Instagram uses
// (source: "youtube").
//
// Scheduling mirrors jobs/inspirationScrapeJob.ts: staleness-based rather
// than a fixed cron expression, so it survives restarts without double-running.

import { prisma } from "../lib/prisma";
import { fetchVideoDetails, listRecentVideos } from "../integrations/youtube";
import { generateYoutubeInsights } from "../lib/contentInsights";

const SCRAPE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const BACKFILL_VIDEO_LIMIT = 50;
const INCREMENTAL_VIDEO_LIMIT = 10;

let isRunning = false;

// Exposed so routes/youtubeVideos.ts's manual "pobierz teraz" endpoint can
// avoid kicking off a second overlapping run if the hourly scheduler (or a
// previous manual click) is already mid-scrape.
export function isYoutubeScrapeRunning(): boolean {
  return isRunning;
}

export async function runYoutubeScrapeJob(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  console.log("[youtube-job] Starting YouTube scrape...");
  try {
    const channels = await prisma.watchedYoutubeChannel.findMany();
    for (const channel of channels) {
      try {
        const existingIds = new Set(
          (
            await prisma.scrapedYoutubeVideo.findMany({
              where: { channelHandle: channel.handle },
              select: { id: true },
            })
          ).map((v) => v.id)
        );
        const isFirstRun = existingIds.size === 0;
        const fetchLimit = isFirstRun ? BACKFILL_VIDEO_LIMIT : INCREMENTAL_VIDEO_LIMIT;

        const summaries = await listRecentVideos(channel.handle, fetchLimit);
        const newSummaries = summaries.filter((v) => !existingIds.has(v.id));
        if (isFirstRun) {
          console.log(`[youtube-job] First run for @${channel.handle}: backfilling ${newSummaries.length} videos.`);
        }

        for (const video of newSummaries) {
          try {
            const details = await fetchVideoDetails(video.id);
            await prisma.scrapedYoutubeVideo.create({
              data: {
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

    try {
      await generateYoutubeInsights();
    } catch (err) {
      console.error("[youtube-job] AI insights generation failed:", err);
    }
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
