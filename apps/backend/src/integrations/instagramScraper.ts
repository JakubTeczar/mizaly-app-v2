// Instagram post scraping via our own Python scraper (apps/instagram-scraper,
// fronting Scrape.do - see that package's README) instead of Apify. Shells
// out to run_scrapedo.py per watched account and maps its output to the same
// ScrapedPost shape the old integrations/apify.ts used, so
// jobs/inspirationScrapeJob.ts didn't need to change its upsert/analysis
// logic - only which function it calls for raw data.
//
// Comments are NOT fetched here (posts only) - Scrape.do's full comment
// pagination costs several extra requests per post, and the Instagram side
// of Inspiracje doesn't need them yet (unlike YouTube, which does fetch and
// keep all comments - see jobs/youtubeScrapeJob.ts). The underlying script
// already supports fetching comments too (run_scrapedo.py --include-comments)
// for whenever that's wanted - not passed here on purpose.

import { execFile } from "child_process";
import path from "path";

const SCRAPER_DIR = path.join(__dirname, "..", "..", "..", "instagram-scraper");
const SCRAPER_ENTRYPOINT = path.join(SCRAPER_DIR, "run_scrapedo.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";

export const POSTS_PER_ACCOUNT = 5;

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
  imageUrl: string;
  videoUrl: string | null;
  isReel: boolean;
  likesCount: number;
  commentsCount: number;
  videoViewCount: number | null;
  username: string;
  postedAt: Date | null;
}

export function isInstagramScraperConfigured(): boolean {
  return Boolean(process.env.SCRAPE_DO_KEY);
}

interface RawScrapedPost {
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
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

// Scrapes each account's recent posts one at a time (rather than one Apify
// actor run for all accounts) so a single account failing (private/renamed/
// deleted) doesn't lose every other account's results in the same run.
export async function scrapeInstagramAccounts(usernames: string[]): Promise<ScrapedPost[]> {
  const results: ScrapedPost[] = [];

  for (const username of usernames) {
    let stdout: string;
    try {
      stdout = await runScraper(username, POSTS_PER_ACCOUNT);
    } catch (err) {
      console.error(`[instagram-scraper] Failed to run scraper for ${username}:`, err);
      continue;
    }

    let parsed: { username?: string; posts?: RawScrapedPost[]; error?: string };
    try {
      parsed = JSON.parse(stdout);
    } catch {
      console.error(`[instagram-scraper] Non-JSON output for ${username}:`, stdout.slice(0, 300));
      continue;
    }

    if (parsed.error) {
      console.error(`[instagram-scraper] Scraper reported an error for ${username}:`, parsed.error);
      continue;
    }

    for (const post of parsed.posts ?? []) {
      if (!post.shortcode) continue;
      const candidates = post.image_versions2?.candidates ?? [];
      const videoVersions = post.video_versions ?? [];
      results.push({
        id: post.shortcode,
        url: `https://www.instagram.com/p/${post.shortcode}/`,
        type: videoVersions.length > 0 ? "Video" : "Image",
        caption: captionText(post.caption),
        imageUrl: candidates[0]?.url ?? "",
        videoUrl: videoVersions[0]?.url ?? null,
        isReel: Boolean(post.clips_metadata),
        likesCount: post.like_count ?? 0,
        commentsCount: post.comment_count ?? 0,
        videoViewCount: null,
        username,
        postedAt: post.taken_at ? new Date(post.taken_at * 1000) : null,
      });
    }
  }

  return results;
}
