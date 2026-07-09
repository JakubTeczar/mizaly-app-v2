// Background job: every day scrape the watched Instagram accounts via
// Apify, upsert the posts into ScrapedInstagramPost, then have OpenAI analyze
// the engagement numbers (likes/comments/views) and store the write-up in
// InspirationAnalysis. API routes only ever read those tables - the Apify
// API is never called from a request handler.
//
// Scheduling is staleness-based rather than a fixed cron expression: on boot
// (and then hourly) we check the newest scrapedAt and run only if it's older
// than SCRAPE_INTERVAL_MS. This survives server restarts/redeploys (Railway)
// without an external cron service and without double-running.

import OpenAI from "openai";
import { prisma } from "../lib/prisma";
import { isApifyConfigured, scrapeInstagramAccounts } from "../integrations/apify";
import { saveImageLocally } from "../lib/localImageStore";

const SCRAPE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const BACKEND_PUBLIC_URL = (process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, "");

let isRunning = false;

async function generateAnalysis(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[inspiration-job] OPENAI_API_KEY missing - skipping AI analysis.");
    return;
  }

  const posts = await prisma.scrapedInstagramPost.findMany({ orderBy: { postedAt: "desc" } });
  if (posts.length === 0) return;

  const summaryInput = posts.map((p) => ({
    username: p.username,
    type: p.type,
    likes: p.likesCount,
    comments: p.commentsCount,
    videoViews: p.videoViewCount,
    postedAt: p.postedAt?.toISOString().slice(0, 10) ?? null,
    caption: p.caption.slice(0, 200),
  }));

  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "Jesteś analitykiem social media. Otrzymasz dane o postach z Instagrama (konto, typ, polubienia, komentarze, wyświetlenia wideo, data, fragment opisu). " +
          "Napisz po polsku zwięzłą analizę (maks. 250 słów): które treści osiągają najlepsze zaangażowanie i dlaczego, " +
          "jakie formaty (wideo/zdjęcie/karuzela) i tematy działają najlepiej, oraz 2-3 konkretne wnioski dla twórcy planującego własne posty. " +
          "Pisz zwykłym tekstem z krótkimi akapitami, bez nagłówków markdown.",
      },
      { role: "user", content: JSON.stringify(summaryInput) },
    ],
  });

  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) return;

  await prisma.inspirationAnalysis.create({ data: { content } });
  console.log("[inspiration-job] AI analysis stored.");
}

export async function runInspirationScrapeJob(): Promise<void> {
  if (isRunning) return;
  if (!isApifyConfigured()) {
    console.warn("[inspiration-job] APIFY_API_KEY missing - skipping scrape.");
    return;
  }

  isRunning = true;
  console.log("[inspiration-job] Starting Instagram scrape...");
  try {
    const watchedAccounts = await prisma.watchedInstagramAccount.findMany();
    const posts = await scrapeInstagramAccounts(watchedAccounts.map((a) => a.username));
    const scrapedAt = new Date();

    for (const post of posts) {
      // Instagram's CDN blocks hotlinking from other domains and the URLs
      // are short-lived anyway, so re-host locally before storing - see
      // lib/localImageStore.ts. Best-effort: fall back to the raw (possibly
      // broken) URL rather than dropping the post if the download fails.
      let imageUrl = post.imageUrl;
      if (post.imageUrl) {
        try {
          const localPath = await saveImageLocally(post.imageUrl, post.id);
          imageUrl = `${BACKEND_PUBLIC_URL}${localPath}`;
        } catch (err) {
          console.error(`[inspiration-job] Failed to re-host image for post ${post.id}:`, err);
        }
      }

      await prisma.scrapedInstagramPost.upsert({
        where: { id: post.id },
        update: {
          caption: post.caption,
          imageUrl,
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
      await generateAnalysis();
    } catch (err) {
      console.error("[inspiration-job] AI analysis failed:", err);
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
