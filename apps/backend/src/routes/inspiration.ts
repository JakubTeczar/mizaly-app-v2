import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import { prisma } from "../lib/prisma";
import { isApifyConfigured } from "../integrations/apify";

const router = Router();

router.use(requireAuth);

// Reads the posts collected by the every-2-days scrape job (see
// src/jobs/inspirationScrapeJob.ts) straight from the DB - no Apify call
// happens here, so this is always fast.
router.get(
  "/trends",
  asyncHandler(async (_req, res) => {
    if (!isApifyConfigured()) {
      return res.json({ status: "work_in_progress", message: "Ta funkcja jest w budowie." });
    }

    const posts = await prisma.scrapedInstagramPost.findMany({ orderBy: { postedAt: "desc" } });
    if (posts.length === 0) {
      return res.json({
        status: "pending",
        message: "Posty są właśnie pobierane w tle. Zajrzyj tu ponownie za kilka minut.",
      });
    }

    const watchedAccounts = await prisma.watchedInstagramAccount.findMany({ orderBy: { createdAt: "asc" } });
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
    const latest = await prisma.inspirationAnalysis.findFirst({ orderBy: { createdAt: "desc" } });
    if (!latest) {
      return res.json({ status: "pending", message: "Analiza pojawi się po pierwszym pobraniu postów." });
    }
    res.json({ status: "ok", content: latest.content, createdAt: latest.createdAt.toISOString() });
  })
);

// Placeholder per ROADMAP.md section 3 - real data source not decided yet.
router.get("/competitors", (_req, res) => {
  res.json({ status: "work_in_progress", message: "Ta funkcja jest w budowie." });
});

export default router;
