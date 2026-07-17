// Classifies scraped Instagram posts / YouTube videos into topic/format/hook
// (see CONTENT_TOPICS/FORMATS/HOOKS in @mizaly/shared) so Inspiracje can show
// an aggregated ranking instead of a single free-text paragraph (see the
// now-removed generateInstagramInsights/generateYoutubeInsights in
// lib/contentInsights.ts). Runs after each scrape, picking up any row with
// topic: null - this also doubles as the one-time backfill for rows scraped
// before this column existed, no separate backfill script needed.

import OpenAI from "openai";
import { CONTENT_CTAS, CONTENT_FORMATS, CONTENT_HOOKS, CONTENT_HOOKS_VISUAL, CONTENT_TOPICS } from "@mizaly/shared";
import { prisma } from "./prisma";
import {
  analyzeImage,
  analyzeVideoFrame,
  transcribeVideo,
  type TranscriptSegment,
  type VideoTranscript,
} from "./mediaAnalysis";

const CLASSIFICATION_SYSTEM_PROMPT =
  `Klasyfikujesz treść social media na dokładnie trzy osie. Odpowiedz WYŁĄCZNIE czystym obiektem JSON ` +
  `{"topic": "...", "format": "...", "hook": "..."} bez żadnego innego tekstu. Każda wartość musi być JEDNĄ ` +
  `z podanych list, zapisaną dokładnie tak jak w liście (użyj "inne" tylko gdy naprawdę nic innego nie pasuje).\n` +
  `Tematy: ${CONTENT_TOPICS.join(", ")}.\n` +
  `Formaty (jak jest podana treść): ${CONTENT_FORMATS.join(", ")}.\n` +
  `Hooki (pierwsza linia/otwarcie): ${CONTENT_HOOKS.join(", ")}.`;

// Separate single-axis prompt for lib/mediaAnalysis.ts's callers (see
// scripts/backfillHookAnalysis.ts): hook here is classified from the post's
// REAL opening content (video transcript's first seconds, or the cover
// image's AI description/on-image text) - not the caption, unlike the
// caption-based `hook` produced by classifyText above via
// CLASSIFICATION_SYSTEM_PROMPT.
const HOOK_ONLY_SYSTEM_PROMPT =
  `Klasyfikujesz WYŁĄCZNIE "hook" - to, co widz widzi lub słyszy w pierwszej chwili (otwierające zdanie ` +
  `mówione, albo tekst/opis widoczny na pierwszym obrazie), a NIE podpis pod postem. Odpowiedz WYŁĄCZNIE ` +
  `czystym obiektem JSON {"hook": "..."} bez żadnego innego tekstu. Wartość musi być JEDNĄ z: ` +
  `${CONTENT_HOOKS.join(", ")} (użyj "inne" tylko gdy naprawdę nic innego nie pasuje).`;

// Visual hook - what's SHOWN (not said/written) in the first frame/image.
// Separate axis from HOOK_ONLY_SYSTEM_PROMPT above, which fits verbal/textual
// hooks, not raw imagery.
const VISUAL_HOOK_SYSTEM_PROMPT =
  `Klasyfikujesz WYŁĄCZNIE wizualny "hook" na podstawie OPISU tego, co widać na pierwszym obrazie/klatce ` +
  `posta - nie na podstawie słów, tekstu czy podpisu. Odpowiedz WYŁĄCZNIE czystym obiektem JSON ` +
  `{"hookVisual": "..."} bez żadnego innego tekstu. Wartość musi być JEDNĄ z: ${CONTENT_HOOKS_VISUAL.join(", ")} ` +
  `(użyj "inne" tylko gdy naprawdę nic innego nie pasuje).`;

// CTA (call-to-action) - judged from ALL available signals (caption,
// transcript, visual description/text), not scoped to just the opening or
// closing moment. Always also returns the literal CTA wording/description in
// ctaDetail, so information isn't lost behind the "inne" bucket.
const CTA_SYSTEM_PROMPT =
  `Znajdujesz "call to action" (CTA) w treści posta na Instagramie - czyli zachętę do konkretnego ` +
  `działania widza. Przeanalizuj WSZYSTKIE podane informacje (podpis, transkrypt, opis obrazu, tekst z ` +
  `obrazu). Odpowiedz WYŁĄCZNIE czystym obiektem JSON {"cta": "...", "ctaDetail": "..."} bez żadnego ` +
  `innego tekstu. "cta" musi być JEDNĄ z: ${CONTENT_CTAS.join(", ")}. "ctaDetail" to krótki (1 zdanie), ` +
  `dosłowny lub bliski dosłownemu opis/cytat konkretnego CTA użytego w tej treści - zawsze go podaj, ` +
  `szczególnie ważne gdy "cta" to "inne", żeby nie zgubić informacji o tym, co to dokładnie było.`;

// Instagram-only variant of CLASSIFICATION_SYSTEM_PROMPT: topic/format judged
// from EVERYTHING known about the post (caption + transcript + visual
// description/text + CTA), not caption alone. Deliberately does not also ask
// for hook - hook is handled by the two dedicated calls above. YouTube keeps
// using classifyText/CLASSIFICATION_SYSTEM_PROMPT unchanged.
const TOPIC_FORMAT_SYSTEM_PROMPT =
  `Klasyfikujesz treść social media na dwie osie, na podstawie WSZYSTKICH dostępnych informacji o poście ` +
  `(podpis, transkrypt, opis obrazu/klatki, tekst z obrazu, CTA). Odpowiedz WYŁĄCZNIE czystym obiektem ` +
  `JSON {"topic": "...", "format": "..."} bez żadnego innego tekstu. Każda wartość musi być JEDNĄ z ` +
  `podanych list, zapisaną dokładnie tak jak w liście (użyj "inne" tylko gdy naprawdę nic innego nie pasuje).\n` +
  `Tematy: ${CONTENT_TOPICS.join(", ")}.\n` +
  `Formaty (jak jest podana treść): ${CONTENT_FORMATS.join(", ")}.`;

// A first backfill can be a few hundred rows at once - keep concurrency
// bounded so this doesn't blow past OpenAI rate limits.
const CONCURRENCY = 5;
// Each Instagram post now costs a Whisper transcription + a vision call +
// several classification calls (see analyzeAndClassifyInstagramPost below) -
// much heavier than YouTube's text-only path above, so lower parallelism
// avoids rate-limit pressure.
const INSTAGRAM_MEDIA_CONCURRENCY = 2;
const HOOK_WINDOW_SECONDS = 5;
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

export async function classifyHookFromSource(text: string): Promise<string> {
  if (!text.trim()) return FALLBACK.hook;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[content-classification] OPENAI_API_KEY missing - skipping.");
    return FALLBACK.hook;
  }

  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: HOOK_ONLY_SYSTEM_PROMPT },
      { role: "user", content: text.slice(0, 2000) },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return FALLBACK.hook;

  try {
    const parsed = JSON.parse(raw);
    return isValid(parsed.hook, CONTENT_HOOKS) ? parsed.hook : "inne";
  } catch {
    console.error("[content-classification] Model returned non-JSON output for hook-only call, using fallback.");
    return FALLBACK.hook;
  }
}

export async function classifyVisualHookFromSource(text: string): Promise<string> {
  if (!text.trim()) return FALLBACK.hook;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[content-classification] OPENAI_API_KEY missing - skipping.");
    return FALLBACK.hook;
  }

  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: VISUAL_HOOK_SYSTEM_PROMPT },
      { role: "user", content: text.slice(0, 2000) },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return FALLBACK.hook;

  try {
    const parsed = JSON.parse(raw);
    return isValid(parsed.hookVisual, CONTENT_HOOKS_VISUAL) ? parsed.hookVisual : "inne";
  } catch {
    console.error("[content-classification] Model returned non-JSON output for visual-hook call, using fallback.");
    return FALLBACK.hook;
  }
}

interface CtaResult {
  cta: string;
  ctaDetail: string;
}

const FALLBACK_CTA: CtaResult = { cta: "brak wyraźnego CTA", ctaDetail: "" };

export async function classifyCta(text: string): Promise<CtaResult> {
  if (!text.trim()) return FALLBACK_CTA;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[content-classification] OPENAI_API_KEY missing - skipping.");
    return FALLBACK_CTA;
  }

  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CTA_SYSTEM_PROMPT },
      { role: "user", content: text.slice(0, 4000) },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return FALLBACK_CTA;

  try {
    const parsed = JSON.parse(raw);
    return {
      cta: isValid(parsed.cta, CONTENT_CTAS) ? parsed.cta : "inne",
      ctaDetail: typeof parsed.ctaDetail === "string" ? parsed.ctaDetail : "",
    };
  } catch {
    console.error("[content-classification] Model returned non-JSON output for CTA call, using fallback.");
    return FALLBACK_CTA;
  }
}

interface TopicFormatResult {
  topic: string;
  format: string;
}

async function classifyTopicFormat(text: string): Promise<TopicFormatResult> {
  if (!text.trim()) return { topic: FALLBACK.topic, format: FALLBACK.format };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[content-classification] OPENAI_API_KEY missing - skipping.");
    return { topic: FALLBACK.topic, format: FALLBACK.format };
  }

  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: TOPIC_FORMAT_SYSTEM_PROMPT },
      { role: "user", content: text.slice(0, 4000) },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return { topic: FALLBACK.topic, format: FALLBACK.format };

  try {
    const parsed = JSON.parse(raw);
    return {
      topic: isValid(parsed.topic, CONTENT_TOPICS) ? parsed.topic : "inne",
      format: isValid(parsed.format, CONTENT_FORMATS) ? parsed.format : "inne",
    };
  } catch {
    console.error("[content-classification] Model returned non-JSON output for topic/format call, using fallback.");
    return { topic: FALLBACK.topic, format: FALLBACK.format };
  }
}

// Opening-window heuristic: the "hook" is whatever's said in roughly the
// first HOOK_WINDOW_SECONDS of the video, not the whole transcript - falls
// back to the full text if nothing starts within that window (fast cuts / a
// beat of silence at the very start) or there are no segments at all.
function hookSourceFromTranscript(segments: TranscriptSegment[], fullText: string): string {
  const opening = segments
    .filter((s) => s.start < HOOK_WINDOW_SECONDS)
    .map((s) => s.text)
    .join(" ")
    .trim();
  return opening || fullText;
}

interface InstagramPostForAnalysis {
  id: string;
  caption: string;
  imageUrl: string;
  videoUrl: string | null;
  transcript: unknown;
  visualDescription: string | null;
  visualText: string | null;
}

// Full pipeline for one Instagram post: media analysis (transcript/visual,
// skip-if-already-present - same spirit as the R2 re-hosting skip in
// jobs/inspirationScrapeJob.ts), then hookText/hookVisual/cta/topic/format,
// each judged from the real content now available instead of caption alone.
// Used both by classifyUnclassifiedInstagramPosts (gated by topic: null, new
// posts only) and scripts/backfillContentAnalysis.ts (explicit
// --username/--limit re-runs against already-classified historical posts).
export async function analyzeAndClassifyInstagramPost(post: InstagramPostForAnalysis): Promise<void> {
  let transcript = post.transcript as VideoTranscript | null;
  let visualDescription = post.visualDescription;
  let visualText = post.visualText;

  if (post.videoUrl) {
    if (!transcript) {
      transcript = await transcribeVideo(post.videoUrl, post.id);
      if (transcript) {
        await prisma.scrapedInstagramPost.update({ where: { id: post.id }, data: { transcript: transcript as any } });
      }
    }
    if (visualDescription === null) {
      const frame = await analyzeVideoFrame(post.videoUrl, post.id);
      if (frame) {
        visualDescription = frame.description;
        visualText = frame.extractedText;
        await prisma.scrapedInstagramPost.update({
          where: { id: post.id },
          data: { visualDescription, visualText },
        });
      }
    }
  } else if (visualDescription === null) {
    const image = await analyzeImage(post.imageUrl, post.id);
    if (image) {
      visualDescription = image.description;
      visualText = image.extractedText;
      await prisma.scrapedInstagramPost.update({
        where: { id: post.id },
        data: { visualDescription, visualText },
      });
    }
  }

  const hookTextSource = transcript ? hookSourceFromTranscript(transcript.segments, transcript.text) : visualText ?? "";
  const hookText = await classifyHookFromSource(hookTextSource);
  const hookVisual = await classifyVisualHookFromSource(visualDescription ?? "");

  const allSignals = [post.caption, transcript?.text, visualDescription, visualText].filter(Boolean).join("\n\n");
  const { cta, ctaDetail } = await classifyCta(allSignals);

  const combinedInput = [allSignals, ctaDetail].filter(Boolean).join("\n\n");
  const { topic, format } = await classifyTopicFormat(combinedInput);

  await prisma.scrapedInstagramPost.update({
    where: { id: post.id },
    data: { hookText, hookVisual, cta, ctaDetail, topic, format },
  });
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
    select: {
      id: true,
      caption: true,
      imageUrl: true,
      videoUrl: true,
      transcript: true,
      visualDescription: true,
      visualText: true,
    },
  });
  if (posts.length === 0) return;

  await runWithConcurrency(posts, INSTAGRAM_MEDIA_CONCURRENCY, analyzeAndClassifyInstagramPost);
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
