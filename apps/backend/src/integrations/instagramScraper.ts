// Instagram post scraping via our own Python scraper (apps/instagram-scraper,
// fronting Scrape.do - see that package's README) instead of Apify. Shells
// out to run_scrapedo.py per watched account and maps its output to the same
// ScrapedPost shape the old integrations/apify.ts used, so
// jobs/inspirationScrapeJob.ts didn't need to change its upsert/analysis
// logic - only which function it calls for raw data.
//
// Comments are opt-in via INSTAGRAM_FETCH_COMMENTS - Scrape.do's full comment
// pagination costs several extra requests per post, so jobs/
// inspirationScrapeJob.ts only calls fetchPostComments() below for a post the
// first time it's scraped (never on later re-scrapes of an already-known
// post), same treatment as the image/video re-hosting there.

import { execFile } from "child_process";
import path from "path";

const SCRAPER_DIR = path.join(__dirname, "..", "..", "..", "instagram-scraper");
const SCRAPER_ENTRYPOINT = path.join(SCRAPER_DIR, "run_scrapedo.py");
const COMMENTS_ENTRYPOINT = path.join(SCRAPER_DIR, "fetch_post_comments.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";

export function isInstagramCommentFetchEnabled(): boolean {
  return process.env.INSTAGRAM_FETCH_COMMENTS === "true";
}

export interface ScrapedComment {
  id: string;
  text: string;
  createdAt: number | null;
  owner: string;
  ownerId: string | null;
  ownerVerified: boolean;
  likes: number;
}

interface RawScrapedComment {
  id?: string | number;
  text?: string | null;
  created_at?: number | null;
  owner?: string | null;
  owner_id?: string | number | null;
  owner_verified?: boolean | null;
  likes?: number | null;
}

// Bumped from 5, then from 20 - the classification ranking and outlier-ratio
// median both need enough accumulated history per account to be statistically
// meaningful (see MIN_RELIABLE_SAMPLE_SIZE in lib/engagementNormalization.ts
// and MIN_GROUP_SIZE in ClassificationRanking.tsx). 20 left too little margin
// above MIN_RELIABLE_SAMPLE_SIZE (10) once the most recent ~1-3 posts are
// excluded as "immature" (<3 days old, see MIN_MATURITY_DAYS) - 25 keeps at
// least ~15 mature posts per account in the common case.
export const POSTS_PER_ACCOUNT = 25;

// Default seed for WatchedInstagramAccount (see lib/watchlistSeed.ts) - fitness
// niche, brand accounts (not individuals) for reliable public scraping. The
// actual watch list editable from the Inspiracje > Instagram tab lives in the
// DB now, not here.
export const DEFAULT_INSTAGRAM_ACCOUNTS = ["gymshark", "crossfit", "bodybuilding_com", "myprotein"];

export interface ScrapedPost {
  id: string;
  url: string;
  type: string;
  caption: string;
  // Cover/first-candidate image - unchanged legacy field, still used as-is by
  // jobs/inspirationScrapeJob.ts (the global watchlist pipeline). Populated
  // even for a video/Reel post (Instagram's own cover), same as always.
  imageUrl: string;
  // ALL image URLs for an image/carousel post (every slide, not just the
  // cover) - empty for any video/Reel post, since a video's real opening is
  // better represented by actual extracted frames (see
  // lib/mediaAnalysis.ts's analyzeVideoFrames) than Instagram's hand-picked
  // cover, which the client explicitly does not want kept/shown for videos.
  // Used by lib/creatorAudit.ts; the legacy global pipeline doesn't read this
  // field yet (still single-cover only there).
  imageUrls: string[];
  videoUrl: string | null;
  isReel: boolean;
  likesCount: number;
  commentsCount: number;
  videoViewCount: number | null;
  username: string;
  postedAt: Date | null;
  // Instagram's internal numeric media id (distinct from the `id`/shortcode
  // above) - needed to fetch comments reliably (see fetchPostComments).
  // Grabbed straight from the account-feed scrape since resolving it by
  // re-scraping the single post page only works for image/carousel posts,
  // not Reels (see fetch_post_comments.py).
  mediaId: string | null;
}

export function isInstagramScraperConfigured(): boolean {
  return Boolean(process.env.SCRAPE_DO_KEY);
}

interface RawScrapedPost {
  pk?: string | number | null;
  shortcode?: string;
  caption?: { text?: string } | string | null;
  taken_at?: number | null;
  like_count?: number | null;
  comment_count?: number | null;
  video_versions?: { url?: string; width?: number }[] | null;
  image_versions2?: { candidates?: { url?: string }[] } | null;
  // Instagram only sets this (non-null, with music/audio metadata) on Reels -
  // a regular feed video post has video_versions but no clips_metadata. See
  // apps/instagram-scraper/instagram.py's parse_user_posts, which already
  // extracts this field from the raw API response.
  clips_metadata?: unknown | null;
  // Present (possibly empty) on every post from this endpoint - non-empty
  // only for an actual carousel (media_type 8). Each slide already comes
  // pre-trimmed to just these three fields by instagram.py's jmespath query.
  carousel_media_count?: number | null;
  carousel_media?: { media_type?: number | null; image_url?: string | null; video_url?: string | null }[] | null;
}

function captionText(caption: RawScrapedPost["caption"]): string {
  if (!caption) return "";
  if (typeof caption === "string") return caption;
  return caption.text || "";
}

function runScraper(username: string, postsCount: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      PYTHON_BIN,
      [SCRAPER_ENTRYPOINT, "--username", username, "--posts", String(postsCount)],
      {
        cwd: SCRAPER_DIR,
        env: process.env,
        timeout: 5 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        // run_scrapedo.py always writes a clean {"error": "..."} JSON to
        // stdout on a caught exception, even when it exits non-zero -
        // stderr is just diagnostic logging (e.g. the "[INFO] scraping..."
        // line), not the real reason. Only fall back to stderr if there's
        // truly no stdout to parse (crashed before writing anything) -
        // otherwise resolve and let the caller's existing `parsed.error`
        // check surface the actual, useful message.
        if (error && !stdout.trim()) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

// Scrapes one account's recent posts - shared by scrapeInstagramAccounts
// below (fixed POSTS_PER_ACCOUNT, for the global watchlist) and
// lib/creatorAudit.ts (caller-supplied count, for a single audited account -
// 10 posts for a first look, then 50/200 once the client approves).
export async function scrapeOneInstagramAccount(username: string, postsCount: number): Promise<ScrapedPost[]> {
  let stdout: string;
  try {
    stdout = await runScraper(username, postsCount);
  } catch (err) {
    console.error(`[instagram-scraper] Failed to run scraper for ${username}:`, err);
    return [];
  }

  let parsed: { username?: string; posts?: RawScrapedPost[]; error?: string };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    console.error(`[instagram-scraper] Non-JSON output for ${username}:`, stdout.slice(0, 300));
    return [];
  }

  if (parsed.error) {
    console.error(`[instagram-scraper] Scraper reported an error for ${username}:`, parsed.error);
    return [];
  }

  const results: ScrapedPost[] = [];
  for (const post of parsed.posts ?? []) {
    if (!post.shortcode) continue;
    const candidates = post.image_versions2?.candidates ?? [];
    const videoVersions = post.video_versions ?? [];
    const isVideo = videoVersions.length > 0;
    const carousel = post.carousel_media ?? [];

    // No cover for a video post - a video's real opening is the actual
    // extracted frames (mediaAnalysis.ts's analyzeVideoFrames), not
    // Instagram's own hand-picked cover image, which can look nothing like
    // it. Otherwise: every slide's image for a carousel, or just the single
    // cover for a plain image post.
    const imageUrls = isVideo
      ? []
      : carousel.length > 0
        ? carousel.map((slide) => slide.image_url).filter((url): url is string => Boolean(url))
        : candidates[0]?.url
          ? [candidates[0].url]
          : [];

    results.push({
      id: post.shortcode,
      url: `https://www.instagram.com/p/${post.shortcode}/`,
      type: isVideo ? "Video" : "Image",
      caption: captionText(post.caption),
      imageUrl: candidates[0]?.url ?? "",
      imageUrls,
      videoUrl: videoVersions[0]?.url ?? null,
      isReel: Boolean(post.clips_metadata),
      likesCount: post.like_count ?? 0,
      commentsCount: post.comment_count ?? 0,
      videoViewCount: null,
      username,
      postedAt: post.taken_at ? new Date(post.taken_at * 1000) : null,
      mediaId: post.pk != null ? String(post.pk) : null,
    });
  }
  return results;
}

// Scrapes each account's recent posts one at a time (rather than one Apify
// actor run for all accounts) so a single account failing (private/renamed/
// deleted) doesn't lose every other account's results in the same run.
export async function scrapeInstagramAccounts(
  usernames: string[],
  onProgress?: (username: string, doneSoFar: number) => void
): Promise<ScrapedPost[]> {
  const results: ScrapedPost[] = [];

  for (let i = 0; i < usernames.length; i++) {
    const username = usernames[i];
    onProgress?.(username, i);
    results.push(...(await scrapeOneInstagramAccount(username, POSTS_PER_ACCOUNT)));
  }

  return results;
}

function runCommentsScript(postUrl: string, mediaId?: string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [COMMENTS_ENTRYPOINT, "--url", postUrl];
    if (mediaId) args.push("--media-id", mediaId);
    execFile(
      PYTHON_BIN,
      args,
      {
        cwd: SCRAPER_DIR,
        env: process.env,
        timeout: 5 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        // Same reasoning as runScraper above - fetch_post_comments.py always
        // writes a clean {"error": "..."} JSON to stdout on a caught
        // exception, even on a non-zero exit. stderr is just diagnostic
        // logging, not the real reason.
        if (error && !stdout.trim()) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

// Fetches all comments for one post. Called by jobs/inspirationScrapeJob.ts
// for a post the first time it's scraped (see isInstagramCommentFetchEnabled
// above) - never for an already-known post - and by lib/creatorAudit.ts for
// every new post. `mediaId` (the account-feed scrape's own `pk`, see
// ScrapedPost) skips this script's internal media_id resolution, which only
// works for image/carousel posts, not Reels - pass it whenever you have it.
export async function fetchPostComments(postUrl: string, mediaId?: string | null): Promise<ScrapedComment[]> {
  let stdout: string;
  try {
    stdout = await runCommentsScript(postUrl, mediaId);
  } catch (err) {
    console.error(`[instagram-scraper] Failed to fetch comments for ${postUrl}:`, err);
    return [];
  }

  let parsed: { comments?: RawScrapedComment[]; error?: string };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    console.error(`[instagram-scraper] Non-JSON comments output for ${postUrl}:`, stdout.slice(0, 300));
    return [];
  }

  if (parsed.error) {
    console.error(`[instagram-scraper] Scraper reported a comments error for ${postUrl}:`, parsed.error);
    return [];
  }

  return (parsed.comments ?? [])
    .filter((c): c is RawScrapedComment & { id: string | number } => c.id != null)
    .map((c) => ({
      id: String(c.id),
      text: c.text ?? "",
      createdAt: c.created_at ?? null,
      owner: c.owner ?? "",
      ownerId: c.owner_id != null ? String(c.owner_id) : null,
      ownerVerified: Boolean(c.owner_verified),
      likes: c.likes ?? 0,
    }));
}
