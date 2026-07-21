import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { prisma } from "../lib/prisma";
import { isInstagramScraperConfigured } from "../integrations/instagramScraper";
import { getInspirationScrapeProgress, isInspirationScrapeRunning, runInspirationScrapeJob } from "../jobs/inspirationScrapeJob";
import { computeNormalizedScores, MIN_RELIABLE_SAMPLE_SIZE } from "../lib/engagementNormalization";

const router = Router();

router.use(requireAuth);

// Polled by the frontend to show live "Pobrano X z Y kont" progress while a
// scrape (manual "pobierz teraz" or the hourly background job) is running.
router.get("/scrape-status", (_req, res) => {
  res.json(getInspirationScrapeProgress());
});

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

// Per-account scrape coverage - lets the frontend show "how much history do
// we actually have per account" (see AccountStatsPanel.tsx) so it's obvious
// why a given account isn't showing up yet in the classification ranking
// (too few mature/classified posts) instead of that just being a mystery.
// No profile-picture scraping happens for watched accounts (would be an
// extra Scrape.do request per account per run), so the most recent post's
// image stands in as a representative thumbnail.
router.get(
  "/instagram-account-stats",
  asyncHandler(async (_req, res) => {
    const watchedAccounts = await prisma.watchedInstagramAccount.findMany({ orderBy: { createdAt: "asc" } });
    const accounts = await Promise.all(
      watchedAccounts.map(async (account) => {
        const [postCount, latestPost] = await Promise.all([
          prisma.scrapedInstagramPost.count({ where: { username: account.username } }),
          prisma.scrapedInstagramPost.findFirst({
            where: { username: account.username },
            orderBy: { postedAt: "desc" },
          }),
        ]);
        return {
          username: account.username,
          postCount,
          lastScrapedAt: latestPost?.scrapedAt.toISOString() ?? null,
          lastPostedAt: latestPost?.postedAt?.toISOString() ?? null,
          thumbnailUrl: latestPost?.imageUrl || null,
        };
      })
    );
    res.json({ accounts });
  })
);

// Latest cached batch of AI-generated content ideas (see
// lib/contentIdeas.ts), refreshed at the end of each scrape job run. Reads
// only - the job is what generates and stores these, not this endpoint.
router.get(
  "/instagram-content-ideas",
  asyncHandler(async (_req, res) => {
    const latest = await prisma.contentIdeaSet.findFirst({
      where: { source: "instagram" },
      orderBy: { createdAt: "desc" },
    });
    res.json({ ideas: latest?.ideas ?? [], generatedAt: latest?.createdAt.toISOString() ?? null });
  })
);

// Latest cached comment segmentation (see lib/commentClustering.ts),
// refreshed at the end of each scrape job run - same read-only pattern as
// /instagram-content-ideas above.
router.get(
  "/instagram-comment-clusters",
  asyncHandler(async (_req, res) => {
    const latest = await prisma.commentClusterSet.findFirst({
      where: { source: "instagram" },
      orderBy: { createdAt: "desc" },
    });
    res.json({ clusters: latest?.clusters ?? [], generatedAt: latest?.createdAt.toISOString() ?? null });
  })
);

// Same as above, scoped to just the "reads as an actual question" subset of
// comments (see lib/commentClustering.ts's isQuestionComment) - higher-signal
// than the general topic segmentation when the goal is specifically "what
// does the audience ask".
router.get(
  "/instagram-question-clusters",
  asyncHandler(async (_req, res) => {
    const latest = await prisma.commentClusterSet.findFirst({
      where: { source: "instagram_questions" },
      orderBy: { createdAt: "desc" },
    });
    res.json({ clusters: latest?.clusters ?? [], generatedAt: latest?.createdAt.toISOString() ?? null });
  })
);

// Same as above, scoped to the "reads as frustration/struggle" subset of
// comments (see lib/commentClustering.ts's isPainPointComment) - "what's hard
// for the audience" as its own lens, independent of the questions view (a
// comment can match both).
router.get(
  "/instagram-pain-point-clusters",
  asyncHandler(async (_req, res) => {
    const latest = await prisma.commentClusterSet.findFirst({
      where: { source: "instagram_pain_points" },
      orderBy: { createdAt: "desc" },
    });
    res.json({ clusters: latest?.clusters ?? [], generatedAt: latest?.createdAt.toISOString() ?? null });
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
type InstagramPrismaSortBy = keyof typeof INSTAGRAM_SORT_OPTIONS;
// "normalized" ranks each post against its own account's median daily
// engagement rate instead of Prisma orderBy - see lib/engagementNormalization.ts.
type InstagramSortBy = InstagramPrismaSortBy | "normalized";

router.get(
  "/trends",
  asyncHandler(async (req, res) => {
    if (!isInstagramScraperConfigured()) {
      return res.json({ status: "work_in_progress", message: "Ta funkcja jest w budowie." });
    }

    const sortByParam = typeof req.query.sortBy === "string" ? req.query.sortBy : "date";
    const sortBy: InstagramSortBy =
      sortByParam === "normalized" || sortByParam in INSTAGRAM_SORT_OPTIONS
        ? (sortByParam as InstagramSortBy)
        : "date";

    // Removing an account from the watchlist (DELETE /api/instagram-accounts/:id)
    // only deletes the watchlist row, not the posts already scraped from it -
    // those stay in ScrapedInstagramPost. Filter to currently-watched
    // usernames here so a removed account's posts disappear from the feed
    // immediately, without cascade-deleting scraped history.
    const watchedAccounts = await prisma.watchedInstagramAccount.findMany({ orderBy: { createdAt: "asc" } });
    const watchedUsernames = watchedAccounts.map((a) => a.username);

    const posts = await prisma.scrapedInstagramPost.findMany({
      where: { username: { in: watchedUsernames } },
      orderBy: sortBy === "normalized" ? { postedAt: "desc" } : INSTAGRAM_SORT_OPTIONS[sortBy],
    });
    if (posts.length === 0) {
      return res.json({
        status: "pending",
        message: "Posty są właśnie pobierane w tle. Zajrzyj tu ponownie za kilka minut.",
      });
    }

    // Computed for every post regardless of sortBy so the frontend can show
    // the "Nx normy konta" badge no matter how the list is currently sorted.
    const scores = computeNormalizedScores(posts, {
      getEngagement: (p) => p.likesCount + p.commentsCount + (p.videoViewCount ?? 0) / 10,
      getPostedAt: (p) => p.postedAt,
      getGroupKey: (p) => p.username,
    });
    const orderedPosts =
      sortBy === "normalized"
        ? [...posts].sort(
            (a, b) => (scores.get(b)!.outlierRatio ?? -Infinity) - (scores.get(a)!.outlierRatio ?? -Infinity)
          )
        : posts;

    const lastScrapedAt = posts.reduce((max, p) => (p.scrapedAt > max ? p.scrapedAt : max), posts[0].scrapedAt);
    res.json({
      status: "ok",
      accounts: watchedAccounts.map((a) => a.username),
      lastScrapedAt: lastScrapedAt.toISOString(),
      posts: orderedPosts.map((p) => {
        const score = scores.get(p)!;
        return {
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
          dailyRate: score.dailyRate,
          outlierRatio: score.outlierRatio,
          isMature: score.isMature,
          // Below MIN_RELIABLE_SAMPLE_SIZE mature posts for this account, the
          // median outlierRatio is measured against is too thin to trust -
          // the frontend shows "za mało danych" instead of a specific number.
          isRatioReliable: score.isMature && score.sampleSize >= MIN_RELIABLE_SAMPLE_SIZE,
          accountSampleSize: score.sampleSize,
          topic: p.topic,
          format: p.format,
          hook: p.hook,
          hookDetail: p.hookDetail,
          cta: p.cta,
          ctaDetail: p.ctaDetail,
          visualDescription: p.visualDescription,
          visualText: p.visualText,
          // Short excerpt only (not the full segments array with timestamps) -
          // this is just for the Inspiracje UI to show "what the video said"
          // when expanding a topic/hook group, not for re-deriving segments.
          transcriptExcerpt:
            p.transcript && typeof p.transcript === "object" && "text" in p.transcript
              ? String((p.transcript as { text: unknown }).text).slice(0, 300)
              : null,
        };
      }),
    });
  })
);

export default router;
