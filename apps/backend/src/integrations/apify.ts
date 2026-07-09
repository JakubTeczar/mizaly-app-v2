// Instagram scraping via Apify's apify/instagram-scraper actor
// (run-sync-get-dataset-items: blocks until the run finishes and returns the
// dataset directly; a run of a few accounts takes ~30-120s and costs Apify
// credits). Called ONLY by the every-2-days background job in
// src/jobs/inspirationScrapeJob.ts, which persists results to the
// ScrapedInstagramPost table - API routes read from the DB, never from here.
//
// Response item shape (confirmed against a live run): { type, shortCode, url,
// caption, likesCount, commentsCount, videoViewCount, displayUrl,
// ownerUsername, timestamp, ... }

const APIFY_BASE_URL = "https://api.apify.com/v2";
const ACTOR_SLUG = "apify~instagram-scraper";

// Default seed for WatchedInstagramAccount (see lib/watchlistSeed.ts) - fitness
// niche, brand accounts (not individuals) for reliable public scraping. The
// actual watch list editable from the Inspiracje > Instagram tab lives in the
// DB now, not here.
export const DEFAULT_INSTAGRAM_ACCOUNTS = ["gymshark", "crossfit", "bodybuilding_com", "myprotein"];
export const POSTS_PER_ACCOUNT = 4;

export function isApifyConfigured(): boolean {
  return Boolean(process.env.APIFY_API_KEY);
}

export interface ScrapedPost {
  id: string;
  url: string;
  type: string;
  caption: string;
  imageUrl: string;
  likesCount: number;
  commentsCount: number;
  videoViewCount: number | null;
  username: string;
  postedAt: Date | null;
}

export async function scrapeInstagramAccounts(accounts: string[]): Promise<ScrapedPost[]> {
  const token = process.env.APIFY_API_KEY;
  if (!token) {
    throw new Error("APIFY_API_KEY is not configured.");
  }
  if (accounts.length === 0) {
    return [];
  }

  const qs = new URLSearchParams({ token, timeout: "280" });
  const res = await fetch(`${APIFY_BASE_URL}/acts/${ACTOR_SLUG}/run-sync-get-dataset-items?${qs.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directUrls: accounts.map((u) => `https://www.instagram.com/${u}/`),
      resultsType: "posts",
      resultsLimit: POSTS_PER_ACCOUNT,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Apify scrape failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const items = (await res.json()) as any[];
  return items
    .filter((item) => item && item.url && (item.id || item.shortCode))
    .map((item) => ({
      id: String(item.id ?? item.shortCode),
      url: item.url,
      type: item.type ?? "Image",
      caption: item.caption ?? "",
      imageUrl: item.displayUrl ?? "",
      likesCount: item.likesCount ?? 0,
      commentsCount: item.commentsCount ?? 0,
      videoViewCount: item.videoViewCount ?? null,
      username: item.ownerUsername ?? "",
      postedAt: item.timestamp ? new Date(item.timestamp) : null,
    }));
}
