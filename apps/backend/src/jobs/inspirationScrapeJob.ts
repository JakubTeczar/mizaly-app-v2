// Background job: every day scrape the watched Instagram accounts via our
// own scraper (apps/instagram-scraper, fronting Scrape.do - see
// integrations/instagramScraper.ts), upsert the posts into
// ScrapedInstagramPost, then classify each unclassified post's topic/format/
// hook (lib/contentClassification.ts) so Inspiracje can rank by them. API
// routes only ever read those tables - the scraper is never called from a
// request handler.
//
// Scheduling is staleness-based rather than a fixed cron expression: on boot
// (and then hourly) we check the newest scrapedAt and run only if it's older
// than SCRAPE_INTERVAL_MS. This survives server restarts/redeploys (Railway)
// without an external cron service and without double-running.

import type { ScrapeProgress } from "@mizaly/shared";
import { prisma } from "../lib/prisma";
import { isInstagramScraperConfigured, scrapeInstagramAccounts } from "../integrations/instagramScraper";
import { saveMediaToR2 } from "../lib/r2Store";
import { classifyUnclassifiedInstagramPosts } from "../lib/contentClassification";

const SCRAPE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const BACKEND_PUBLIC_URL = (process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, "");

let isRunning = false;
let progress: { total: number; done: number; current: string | null } = { total: 0, done: 0, current: null };

// Exposed so routes/inspiration.ts's manual "pobierz teraz" endpoint can
// avoid kicking off a second overlapping run if the hourly scheduler (or a
// previous manual click) is already mid-scrape.
export function isInspirationScrapeRunning(): boolean {
  return isRunning;
}

// Exposed so the frontend can poll and show "Pobrano X z Y kont" while a
// scrape (manual or hourly-scheduled) is in progress.
export function getInspirationScrapeProgress(): ScrapeProgress {
  return { isRunning, ...progress };
}

export async function runInspirationScrapeJob(): Promise<void> {
  if (isRunning) return;
  if (!isInstagramScraperConfigured()) {
    console.warn("[inspiration-job] SCRAPE_DO_KEY missing - skipping scrape.");
    return;
  }

  isRunning = true;
  console.log("[inspiration-job] Starting Instagram scrape...");
  try {
    const watchedAccounts = await prisma.watchedInstagramAccount.findMany();
    progress = { total: watchedAccounts.length, done: 0, current: null };
    const posts = await scrapeInstagramAccounts(watchedAccounts.map((a) => a.username), (username, doneSoFar) => {
      progress = { ...progress, done: doneSoFar, current: username };
    });
    progress = { ...progress, done: progress.total, current: null };
    const scrapedAt = new Date();

    for (const post of posts) {
      // Matched by (username, postedAt) rather than `id` - Instagram's own
      // post identifier has changed format before (raw numeric pk -> the
      // current shortcode) and silently produced duplicate rows for the
      // same real post when it did, since upsert-by-id can't tell a changed
      // id apart from a genuinely new post. (username, postedAt) is stable
      // regardless of what id scheme is in use - see the unique constraint
      // on ScrapedInstagramPost. Falls back to matching by `id` for the rare
      // post with no postedAt, since Postgres treats every NULL as distinct
      // (the unique constraint wouldn't catch a real duplicate there anyway).
      const uniqueWhere = post.postedAt
        ? { username_postedAt: { username: post.username, postedAt: post.postedAt } }
        : { id: post.id };

      // A post's media never changes once published, so a post already
      // seen in a previous run keeps its already-stored R2 urls instead of
      // re-downloading/re-uploading the same bytes every day - only the
      // engagement counters below are worth refreshing.
      const existing = await prisma.scrapedInstagramPost.findUnique({ where: uniqueWhere });

      let imageUrl = existing?.imageUrl ?? post.imageUrl;
      if (!existing && post.imageUrl) {
        // Instagram's CDN blocks hotlinking from other domains and the URLs
        // are short-lived anyway, so re-host in Cloudflare R2 before storing -
        // see lib/r2Store.ts. Best-effort: fall back to the raw (possibly
        // broken) URL rather than dropping the post if the download fails.
        try {
          const path = await saveMediaToR2(post.imageUrl, post.id, "jpg");
          imageUrl = `${BACKEND_PUBLIC_URL}${path}`;
        } catch (err) {
          console.error(`[inspiration-job] Failed to re-host image for post ${post.id}:`, err);
        }
      }

      let videoUrl: string | null = existing?.videoUrl ?? null;
      if (!existing && post.videoUrl) {
        // Reels/feed videos: video_versions links are just as short-lived as
        // the image ones, so the actual video file is downloaded and
        // re-hosted the same way (previously this was skipped entirely -
        // only the thumbnail was ever saved).
        try {
          const path = await saveMediaToR2(post.videoUrl, post.id, "mp4");
          videoUrl = `${BACKEND_PUBLIC_URL}${path}`;
        } catch (err) {
          console.error(`[inspiration-job] Failed to re-host video for post ${post.id}:`, err);
        }
      }

      await prisma.scrapedInstagramPost.upsert({
        where: uniqueWhere,
        update: {
          id: post.id,
          url: post.url,
          type: post.type,
          caption: post.caption,
          imageUrl,
          videoUrl,
          isReel: post.isReel,
          likesCount: post.likesCount,
          commentsCount: post.commentsCount,
          videoViewCount: post.videoViewCount,
          scrapedAt,
        },
        create: {
          id: post.id,
          username: post.username,
          url: post.url,
          type: post.type,
          caption: post.caption,
          imageUrl,
          videoUrl,
          isReel: post.isReel,
          likesCount: post.likesCount,
          commentsCount: post.commentsCount,
          videoViewCount: post.videoViewCount,
          postedAt: post.postedAt,
          scrapedAt,
        },
      });
    }
    console.log(`[inspiration-job] Stored ${posts.length} posts.`);

    try {
      await classifyUnclassifiedInstagramPosts();
    } catch (err) {
      console.error("[inspiration-job] Content classification failed:", err);
    }
  } catch (err) {
    console.error("[inspiration-job] Scrape failed:", err);
  } finally {
    isRunning = false;
  }
}

async function runIfStale(): Promise<void> {
  const newest = await prisma.scrapedInstagramPost.findFirst({ orderBy: { scrapedAt: "desc" } });
  if (!newest || Date.now() - newest.scrapedAt.getTime() > SCRAPE_INTERVAL_MS) {
    await runInspirationScrapeJob();
  }
}

export function startInspirationScrapeScheduler(): void {
  // Small boot delay so a crash-looping server doesn't hammer Apify.
  setTimeout(() => {
    runIfStale().catch((err) => console.error("[inspiration-job] Initial check failed:", err));
  }, 10_000);

  setInterval(() => {
    runIfStale().catch((err) => console.error("[inspiration-job] Periodic check failed:", err));
  }, CHECK_EVERY_MS);
}
