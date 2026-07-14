// Reads videos collected by the daily scrape job (see
// src/jobs/youtubeScrapeJob.ts) straight from the DB, plus on-demand AI
// analysis of a single video's transcript/comments. No yt-dlp call happens
// here (outside /scrape-now below) - normally this only ever runs from the
// background job.

import { Router } from "express";
import OpenAI from "openai";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { requireAuth } from "../middleware/requireAuth";
import { isYoutubeScrapeRunning, runYoutubeScrapeJob } from "../jobs/youtubeScrapeJob";

const router = Router();

router.use(requireAuth);

// Manual "pobierz teraz" trigger - mirrors POST /api/inspiration/scrape-now.
// Awaits the full scrape (yt-dlp per watched channel) before responding.
router.post(
  "/scrape-now",
  asyncHandler(async (_req, res) => {
    if (isYoutubeScrapeRunning()) {
      throw new HttpError(409, "Pobieranie już w toku, spróbuj za chwilę.");
    }

    await runYoutubeScrapeJob();

    const newest = await prisma.scrapedYoutubeVideo.findFirst({ orderBy: { scrapedAt: "desc" } });
    res.json({ lastScrapedAt: newest?.scrapedAt.toISOString() ?? null });
  })
);

const YOUTUBE_SORT_OPTIONS = {
  date: { publishedAt: "desc" as const },
  views: { viewCount: "desc" as const },
  likes: { likeCount: "desc" as const },
  comments: { commentCount: "desc" as const },
};
type YoutubeSortBy = keyof typeof YOUTUBE_SORT_OPTIONS;

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const channelHandle = typeof req.query.channel === "string" ? req.query.channel : undefined;
    const sortByParam = typeof req.query.sortBy === "string" ? req.query.sortBy : "date";
    const sortBy: YoutubeSortBy = sortByParam in YOUTUBE_SORT_OPTIONS ? (sortByParam as YoutubeSortBy) : "date";

    // Removing a channel from the watchlist (DELETE /api/youtube-channels/:id)
    // only deletes the watchlist row, not the videos already scraped from it
    // - those stay in ScrapedYoutubeVideo. Filter to currently-watched handles
    // here so a removed creator's videos disappear from the list immediately,
    // without having to cascade-delete scraped history.
    const watchedHandles = (await prisma.watchedYoutubeChannel.findMany({ select: { handle: true } })).map(
      (c) => c.handle
    );
    const effectiveHandles = channelHandle ? watchedHandles.filter((h) => h === channelHandle) : watchedHandles;

    const videos = await prisma.scrapedYoutubeVideo.findMany({
      where: { channelHandle: { in: effectiveHandles } },
      orderBy: YOUTUBE_SORT_OPTIONS[sortBy],
      select: {
        id: true,
        channelHandle: true,
        title: true,
        thumbnailUrl: true,
        viewCount: true,
        likeCount: true,
        commentCount: true,
        durationSec: true,
        publishedAt: true,
        scrapedAt: true,
      },
    });
    res.json(videos);
  })
);

// Section-level AI insight (emotions/questions/themes across recent videos'
// comments), generated at the end of each scrape run - see
// lib/contentInsights.ts's generateYoutubeInsights(). Distinct from the
// per-video on-demand /:id/analyze below.
router.get(
  "/insights",
  asyncHandler(async (_req, res) => {
    const latest = await prisma.inspirationAnalysis.findFirst({
      where: { source: "youtube" },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) {
      return res.json({ status: "pending", message: "Analiza pojawi się po pierwszym pobraniu filmów." });
    }
    res.json({ status: "ok", content: latest.content, createdAt: latest.createdAt.toISOString() });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const video = await prisma.scrapedYoutubeVideo.findUnique({
      where: { id: req.params.id },
      include: { comments: { orderBy: { likeCount: "desc" } } },
    });
    if (!video) {
      throw new HttpError(404, "Nie znaleziono filmu.");
    }
    res.json(video);
  })
);

const ANALYZE_ACTIONS = {
  summarize: {
    needsTranscript: true,
    systemPrompt:
      "Jesteś asystentem analizującym treści wideo na YouTube. Otrzymasz transkrypcję filmu. " +
      "Streść ją po polsku w maksymalnie 200 słowach - zwięźle, konkretnie, bez lania wody. " +
      "Pisz zwykłym tekstem z krótkimi akapitami, bez nagłówków markdown.",
  },
  objections: {
    needsTranscript: false,
    systemPrompt:
      "Jesteś asystentem analizującym komentarze pod filmem na YouTube. Otrzymasz listę komentarzy w formacie JSON. " +
      "Znajdź i opisz po polsku wszelkie obiekcje, wątpliwości, krytykę lub negatywne opinie widzów wobec treści filmu. " +
      "Jeśli takich komentarzy nie ma, napisz wprost, że nie znalazłeś żadnych obiekcji. " +
      "Pisz zwykłym tekstem, w punktach zaczynających się od myślnika, bez nagłówków markdown.",
  },
  topics: {
    needsTranscript: false,
    systemPrompt:
      "Jesteś asystentem analizującym komentarze pod filmem na YouTube. Otrzymasz listę komentarzy w formacie JSON. " +
      "Znajdź tematy, pytania lub wątki, które powtarzają się w wielu komentarzach - takie, do których twórca mógłby " +
      "nawiązać w kolejnych treściach. Dla każdego tematu podaj krótki opis i przybliżoną liczbę komentarzy, w których się pojawia. " +
      "Jeśli nic się wyraźnie nie powtarza, napisz to wprost. Pisz zwykłym tekstem, w punktach zaczynających się od myślnika, bez nagłówków markdown.",
  },
} as const;

const analyzeSchema = z.object({
  action: z.enum(["summarize", "objections", "topics"]),
});

router.post(
  "/:id/analyze",
  asyncHandler(async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "OpenAI API key nie jest skonfigurowany." });
      return;
    }

    const { action } = analyzeSchema.parse(req.body);
    const video = await prisma.scrapedYoutubeVideo.findUnique({
      where: { id: req.params.id },
      include: { comments: { orderBy: { likeCount: "desc" } } },
    });
    if (!video) {
      throw new HttpError(404, "Nie znaleziono filmu.");
    }

    const config = ANALYZE_ACTIONS[action];
    if (config.needsTranscript && !video.transcript) {
      res.status(422).json({ error: "Ten film nie ma dostępnej transkrypcji." });
      return;
    }
    if (!config.needsTranscript && video.comments.length === 0) {
      res.status(422).json({ error: "Ten film nie ma jeszcze pobranych komentarzy." });
      return;
    }

    const userContent = config.needsTranscript
      ? video.transcript!
      : JSON.stringify(video.comments.map((c) => ({ author: c.author, text: c.text, likes: c.likeCount })));

    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: config.systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    const result = completion.choices[0]?.message?.content?.trim() ?? "";
    res.json({ result });
  })
);

export default router;
