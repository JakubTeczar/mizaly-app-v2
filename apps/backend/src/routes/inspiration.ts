import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { prisma } from "../lib/prisma";
import { isInstagramScraperConfigured } from "../integrations/instagramScraper";
import { isInspirationScrapeRunning, runInspirationScrapeJob } from "../jobs/inspirationScrapeJob";

const router = Router();

router.use(requireAuth);

// Manual "pobierz teraz" trigger - runs the same scrape the hourly scheduler
// would (see jobs/inspirationScrapeJob.ts), bypassing its staleness check.
// Awaits the full scrape (scraper + OpenAI analysis) before responding, so
// the frontend button should show a loading state for the duration.
router.post(
  "/scrape-now",
  asyncHandler(async (_req, res) => {
    if (!isInstagramScraperConfigured()) {
      throw new HttpError(503, "Scraper Instagrama (Scrape.do) nie jest skonfigurowany.");
    }
    if (isInspirationScrapeRunning()) {
      throw new HttpError(409, "Pobieranie już w toku, spróbuj za chwilę.");
    }

    await runInspirationScrapeJob();

    const newest = await prisma.scrapedInstagramPost.findFirst({ orderBy: { scrapedAt: "desc" } });
    res.json({ lastScrapedAt: newest?.scrapedAt.toISOString() ?? null });
  })
);

// Reads the posts collected by the daily scrape job (see
// src/jobs/inspirationScrapeJob.ts) straight from the DB - no scraper call
// happens here, so this is always fast.
const INSTAGRAM_SORT_OPTIONS = {
  date: { postedAt: "desc" as const },
  likes: { likesCount: "desc" as const },
  comments: { commentsCount: "desc" as const },
  views: [{ videoViewCount: { sort: "desc" as const, nulls: "last" as const } }],
};
type InstagramSortBy = keyof typeof INSTAGRAM_SORT_OPTIONS;

router.get(
  "/trends",
  asyncHandler(async (req, res) => {
    if (!isInstagramScraperConfigured()) {
      return res.json({ status: "work_in_progress", message: "Ta funkcja jest w budowie." });
    }

    const sortByParam = typeof req.query.sortBy === "string" ? req.query.sortBy : "date";
    const sortBy: InstagramSortBy = sortByParam in INSTAGRAM_SORT_OPTIONS ? (sortByParam as InstagramSortBy) : "date";

    // Removing an account from the watchlist (DELETE /api/instagram-accounts/:id)
    // only deletes the watchlist row, not the posts already scraped from it -
    // those stay in ScrapedInstagramPost. Filter to currently-watched
    // usernames here so a removed account's posts disappear from the feed
    // immediately, without cascade-deleting scraped history.
    const watchedAccounts = await prisma.watchedInstagramAccount.findMany({ orderBy: { createdAt: "asc" } });
    const watchedUsernames = watchedAccounts.map((a) => a.username);

    const posts = await prisma.scrapedInstagramPost.findMany({
      where: { username: { in: watchedUsernames } },
      orderBy: INSTAGRAM_SORT_OPTIONS[sortBy],
    });
    if (posts.length === 0) {
      return res.json({
        status: "pending",
        message: "Posty są właśnie pobierane w tle. Zajrzyj tu ponownie za kilka minut.",
      });
    }

    const lastScrapedAt = posts.reduce((max, p) => (p.scrapedAt > max ? p.scrapedAt : max), posts[0].scrapedAt);
    res.json({
      status: "ok",
      accounts: watchedAccounts.map((a) => a.username),
      lastScrapedAt: lastScrapedAt.toISOString(),
      posts: posts.map((p) => ({
        id: p.id,
        url: p.url,
        type: p.type,
        caption: p.caption,
        imageUrl: p.imageUrl,
        videoUrl: p.videoUrl,
        isReel: p.isReel,
        likesCount: p.likesCount,
        commentsCount: p.commentsCount,
        videoViewCount: p.videoViewCount,
        username: p.username,
        timestamp: p.postedAt?.toISOString() ?? "",
      })),
    });
  })
);

// Latest AI engagement analysis, generated at the end of each scrape run.
router.get(
  "/analysis",
  asyncHandler(async (_req, res) => {
    const latest = await prisma.inspirationAnalysis.findFirst({
      where: { source: "instagram" },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) {
      return res.json({ status: "pending", message: "Analiza pojawi się po pierwszym pobraniu postów." });
    }
    res.json({ status: "ok", content: latest.content, createdAt: latest.createdAt.toISOString() });
  })
);

// Placeholder per docs/ROADMAP.md section 3 - real data source not decided yet.
router.get("/competitors", (_req, res) => {
  res.json({ status: "work_in_progress", message: "Ta funkcja jest w budowie." });
});

export default router;
