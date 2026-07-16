// Classifies scraped Instagram posts / YouTube videos into topic/format/hook
// (see CONTENT_TOPICS/FORMATS/HOOKS in @mizaly/shared) so Inspiracje can show
// an aggregated ranking instead of a single free-text paragraph (see the
// now-removed generateInstagramInsights/generateYoutubeInsights in
// lib/contentInsights.ts). Runs after each scrape, picking up any row with
// topic: null - this also doubles as the one-time backfill for rows scraped
// before this column existed, no separate backfill script needed.

import OpenAI from "openai";
import { CONTENT_FORMATS, CONTENT_HOOKS, CONTENT_TOPICS } from "@mizaly/shared";
import { prisma } from "./prisma";

const CLASSIFICATION_SYSTEM_PROMPT =
  `Klasyfikujesz treść social media na dokładnie trzy osie. Odpowiedz WYŁĄCZNIE czystym obiektem JSON ` +
  `{"topic": "...", "format": "...", "hook": "..."} bez żadnego innego tekstu. Każda wartość musi być JEDNĄ ` +
  `z podanych list, zapisaną dokładnie tak jak w liście (użyj "inne" tylko gdy naprawdę nic innego nie pasuje).\n` +
  `Tematy: ${CONTENT_TOPICS.join(", ")}.\n` +
  `Formaty (jak jest podana treść): ${CONTENT_FORMATS.join(", ")}.\n` +
  `Hooki (pierwsza linia/otwarcie): ${CONTENT_HOOKS.join(", ")}.`;

// A first backfill can be a few hundred rows at once - keep concurrency
// bounded so this doesn't blow past OpenAI rate limits.
const CONCURRENCY = 5;
const FALLBACK: Classification = { topic: "inne", format: "inne", hook: "inne" };

interface Classification {
  topic: string;
  format: string;
  hook: string;
}

function isValid<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

async function classifyText(text: string): Promise<Classification> {
  if (!text.trim()) return FALLBACK;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[content-classification] OPENAI_API_KEY missing - skipping.");
    return FALLBACK;
  }

  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
      { role: "user", content: text.slice(0, 2000) },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return FALLBACK;

  try {
    const parsed = JSON.parse(raw);
    return {
      topic: isValid(parsed.topic, CONTENT_TOPICS) ? parsed.topic : "inne",
      format: isValid(parsed.format, CONTENT_FORMATS) ? parsed.format : "inne",
      hook: isValid(parsed.hook, CONTENT_HOOKS) ? parsed.hook : "inne",
    };
  } catch {
    console.error("[content-classification] Model returned non-JSON output, using fallback.");
    return FALLBACK;
  }
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    const current = index++;
    if (current >= items.length) return;
    await worker(items[current]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

export async function classifyUnclassifiedInstagramPosts(): Promise<void> {
  const posts = await prisma.scrapedInstagramPost.findMany({
    where: { topic: null },
    select: { id: true, caption: true },
  });
  if (posts.length === 0) return;

  await runWithConcurrency(posts, CONCURRENCY, async (post) => {
    const result = await classifyText(post.caption);
    await prisma.scrapedInstagramPost.update({ where: { id: post.id }, data: result });
  });
  console.log(`[content-classification] Classified ${posts.length} Instagram post(s).`);
}

export async function classifyUnclassifiedYoutubeVideos(): Promise<void> {
  const videos = await prisma.scrapedYoutubeVideo.findMany({
    where: { topic: null },
    select: { id: true, title: true, transcript: true },
  });
  if (videos.length === 0) return;

  await runWithConcurrency(videos, CONCURRENCY, async (video) => {
    const text = video.transcript ? `${video.title}\n\n${video.transcript.slice(0, 1500)}` : video.title;
    const result = await classifyText(text);
    await prisma.scrapedYoutubeVideo.update({ where: { id: video.id }, data: result });
  });
  console.log(`[content-classification] Classified ${videos.length} YouTube video(s).`);
}
