// Classifies scraped Instagram posts / YouTube videos into topic/format/hook
// (see CONTENT_TOPICS/FORMATS/HOOKS in @mizaly/shared) so Inspiracje can show
// an aggregated ranking instead of a single free-text paragraph (see the
// now-removed generateInstagramInsights/generateYoutubeInsights in
// lib/contentInsights.ts). Runs after each scrape, picking up any row with
// topic: null - this also doubles as the one-time backfill for rows scraped
// before this column existed, no separate backfill script needed.

import OpenAI from "openai";
import {
  CONTENT_CTAS,
  CONTENT_CTA_LOCATIONS,
  CONTENT_FORMATS,
  CONTENT_HOOKS,
  CONTENT_HOOKS_UNIFIED,
  CONTENT_HOOKS_VISUAL,
  CONTENT_TOPICS,
} from "@mizaly/shared";
import { prisma } from "./prisma";
import { withOpenAiRetry } from "./openaiRetry";
import {
  analyzeImage,
  analyzeVideoFrames,
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
  `JSON {"topic": "...", "format": "...", "formatDetail": "..."} bez żadnego innego tekstu. "topic" i "format" ` +
  `muszą być JEDNĄ z podanych list, zapisaną dokładnie tak jak w liście (użyj "inne" tylko gdy naprawdę nic ` +
  `innego nie pasuje).\n` +
  `Tematy: ${CONTENT_TOPICS.join(", ")}.\n` +
  `Formaty (jak jest podana treść): ${CONTENT_FORMATS.join(", ")}.\n` +
  `"formatDetail" to DOSŁOWNY cytat konkretnego fragmentu treści, który uzasadnia wybrany "format" (np. dla ` +
  `"ranking/listicle" cytat samej listy/pozycji typu "TOP 5 ...", nie ogólny fragment podpisu niezwiązany z tym, ` +
  `że to jest lista) - zawsze go podaj, w całości, bez sztucznego skracania do jednego zdania.`;

// A first backfill can be a few hundred rows at once - keep concurrency
// bounded so this doesn't blow past OpenAI rate limits.
const CONCURRENCY = 5;
// Each Instagram post now costs a Whisper transcription + a vision call +
// several classification calls (see analyzeAndClassifyInstagramPost below) -
// much heavier than YouTube's text-only path above, so lower parallelism
// avoids rate-limit pressure.
const INSTAGRAM_MEDIA_CONCURRENCY = 2;
// Exported so lib/creatorAudit.ts's own-account-audit pipeline derives the
// hook-source window the exact same way instead of duplicating the constant.
// Widened from 5 -> 10s (client feedback: 5s cut off too much of a Reel's
// real opening beat/line).
export const HOOK_WINDOW_SECONDS = 10;
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
  const completion = await withOpenAiRetry(() => client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
      { role: "user", content: text.slice(0, 2000) },
    ],
  }));

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
  const completion = await withOpenAiRetry(() => client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: HOOK_ONLY_SYSTEM_PROMPT },
      { role: "user", content: text.slice(0, 2000) },
    ],
  }));

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
  const completion = await withOpenAiRetry(() => client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: VISUAL_HOOK_SYSTEM_PROMPT },
      { role: "user", content: text.slice(0, 2000) },
    ],
  }));

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

// Own-content-audit-only (lib/creatorAudit.ts) hook analysis: ONE combined
// judgment per medium instead of the legacy hookText/hookVisual split above -
// a Reel's hook is inherently multi-modal (you see AND hear the opening at
// once), and judging it as two separate axes sometimes produced
// classifications that didn't actually agree with each other. Also always
// returns a concrete one-sentence "detail" (same idea as ctaDetail below) so
// the category alone doesn't hide what the hook actually was.
const HOOK_VIDEO_SYSTEM_PROMPT =
  `Analizujesz hook (pierwsze wrażenie) Reelsa/wideo na Instagramie. Dostajesz dwa oznaczone sygnały: opis ` +
  `pierwszych klatek nagrania (co widać) oraz transkrypt pierwszych kilku sekund (co słychać/jest mówione) - ` +
  `NIE podpis pod postem, tylko to, co widz faktycznie widzi i słyszy w pierwszej chwili. Kadrowanie/ruch kamery ` +
  `(zbliżenie na twarz, dynamiczny ruch itp.) jest już rejestrowane osobno jako sygnał wizualny - hook ma opisywać ` +
  `TREŚĆ/NARRACJĘ otwarcia (o czym mówi/co obiecuje pierwsza wypowiedź: pytanie, szokujące twierdzenie, problem na ` +
  `starcie, osobista historia, porada/rada, cliffhanger, itd.), a nie sam kadr. Wybierz kategorię kadrową (np. ` +
  `"zbliżenie na twarz/emocję", "dynamiczny ruch/akcja") TYLKO gdy w pierwszych sekundach naprawdę nie ma żadnej ` +
  `wypowiedzi/treści niosącej sens (np. cisza, samo tło) - jeśli ktoś coś mówi lub coś obiecuje, zawsze wybierz ` +
  `kategorię narracyjną. Odpowiadaj WYŁĄCZNIE PO POLSKU. Odpowiedz WYŁĄCZNIE czystym obiektem JSON {"hookVideo": ` +
  `"...", "hookVideoDetail": "..."} bez żadnego innego tekstu. "hookVideo" musi być JEDNĄ z: ` +
  `${CONTENT_HOOKS_UNIFIED.join(", ")} (użyj "inne" tylko gdy naprawdę nic innego nie pasuje). "hookVideoDetail" ` +
  `to DOSŁOWNY cytat całego hooka - cała otwierająca wypowiedź/zdanie(a) odpowiedzialne za przyciągnięcie uwagi ` +
  `(nie skracaj go sztucznie do jednego zdania, jeśli hook realnie trwa dłużej - podaj go w całości, dokładnie ` +
  `tak jak zostało powiedziane), albo dokładny opis kadru gdy hook jest czysto wizualny - zawsze je podaj.`;

export async function classifyVideoHook(
  frameDescription: string,
  transcriptWindow: string
): Promise<{ hookVideo: string; hookVideoDetail: string }> {
  const combined = [
    frameDescription ? `Opis pierwszych klatek: ${frameDescription}` : "",
    transcriptWindow ? `Transkrypt pierwszych ${HOOK_WINDOW_SECONDS}s: ${transcriptWindow}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const fallback = { hookVideo: "inne", hookVideoDetail: "" };
  if (!combined.trim()) return fallback;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[content-classification] OPENAI_API_KEY missing - skipping.");
    return fallback;
  }

  const client = new OpenAI({ apiKey });
  const completion = await withOpenAiRetry(() => client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: HOOK_VIDEO_SYSTEM_PROMPT },
      { role: "user", content: combined.slice(0, 3000) },
    ],
  }));

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    return {
      hookVideo: isValid(parsed.hookVideo, CONTENT_HOOKS_UNIFIED) ? parsed.hookVideo : "inne",
      hookVideoDetail: typeof parsed.hookVideoDetail === "string" ? parsed.hookVideoDetail : "",
    };
  } catch {
    console.error("[content-classification] Model returned non-JSON output for video-hook call, using fallback.");
    return fallback;
  }
}

// Post/carousel sibling of classifyVideoHook - judged ONLY from the first
// (opening) image, never later carousel slides, matching "hook = first
// moment" semantics.
const HOOK_POST_SYSTEM_PROMPT =
  `Analizujesz hook (pierwsze wrażenie) posta/zdjęcia na Instagramie na podstawie OPISU pierwszego, jedynego ` +
  `widocznego na starcie zdjęcia - co na nim widać oraz jaki tekst jest na nim zapisany - NIE podpisu pod ` +
  `postem. Tekst zapisany NA zdjęciu to GŁÓWNY sygnał - to widz czyta jako pierwsze, natychmiast, więc jeśli na ` +
  `zdjęciu jest jakikolwiek tekst, to on w pierwszej kolejności decyduje o hooku i jego treści (opis obrazu jest ` +
  `sygnałem pomocniczym/drugorzędnym, używanym gdy tekstu brak albo nie wystarcza do klasyfikacji). Kadrowanie ` +
  `zdjęcia (zbliżenie na twarz itp.) jest już rejestrowane osobno jako sygnał wizualny - hook ma opisywać TREŚĆ ` +
  `tego tekstu/przekazu (pytanie, szokujące twierdzenie, problem na starcie, osobista historia, porada/rada, ` +
  `itd.), nie sam kadr - wybierz kategorię czysto kadrową tylko gdy na zdjęciu naprawdę nie ma żadnego tekstu ` +
  `niosącego treść. Odpowiadaj WYŁĄCZNIE PO POLSKU. Odpowiedz WYŁĄCZNIE czystym obiektem JSON {"hookPost": "...", ` +
  `"hookPostDetail": "..."} bez żadnego innego tekstu. "hookPost" musi być JEDNĄ z: ` +
  `${CONTENT_HOOKS_UNIFIED.join(", ")} (użyj "inne" tylko gdy naprawdę nic innego nie pasuje). "hookPostDetail" ` +
  `to DOSŁOWNY cytat całego hooka - cały napis widoczny na zdjęciu odpowiedzialny za przyciągnięcie uwagi (nie ` +
  `skracaj go sztucznie do jednego zdania, podaj go w całości, dokładnie tak jak jest zapisany), albo dokładny ` +
  `opis kadru gdy hook jest czysto wizualny - zawsze je podaj.`;

export async function classifyPostHook(
  imageDescription: string,
  imageText: string
): Promise<{ hookPost: string; hookPostDetail: string }> {
  const combined = [
    imageDescription ? `Opis zdjęcia: ${imageDescription}` : "",
    imageText ? `Tekst na zdjęciu: ${imageText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const fallback = { hookPost: "inne", hookPostDetail: "" };
  if (!combined.trim()) return fallback;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[content-classification] OPENAI_API_KEY missing - skipping.");
    return fallback;
  }

  const client = new OpenAI({ apiKey });
  const completion = await withOpenAiRetry(() => client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: HOOK_POST_SYSTEM_PROMPT },
      { role: "user", content: combined.slice(0, 3000) },
    ],
  }));

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    return {
      hookPost: isValid(parsed.hookPost, CONTENT_HOOKS_UNIFIED) ? parsed.hookPost : "inne",
      hookPostDetail: typeof parsed.hookPostDetail === "string" ? parsed.hookPostDetail : "",
    };
  } catch {
    console.error("[content-classification] Model returned non-JSON output for post-hook call, using fallback.");
    return fallback;
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
  const completion = await withOpenAiRetry(() => client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CTA_SYSTEM_PROMPT },
      { role: "user", content: text.slice(0, 4000) },
    ],
  }));

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

interface CtaWithLocationResult extends CtaResult {
  ctaLocation: string;
}

const FALLBACK_CTA_WITH_LOCATION: CtaWithLocationResult = { ...FALLBACK_CTA, ctaLocation: "brak" };

// Own-content-audit-only (lib/creatorAudit.ts) sibling of classifyCta that
// also tags WHERE the CTA actually sits - "treść główna" (spoken/on-screen,
// in the Reel/image itself) vs "opis" (the caption, read separately/later)
// vs "oba" - client wants to compare which placement performs better, not
// just whether a CTA exists at all. Needs the two signals kept apart in the
// input (not pre-joined into one blob like classifyCta above) so the model
// can tell which section it found the CTA in.
const CTA_WITH_LOCATION_SYSTEM_PROMPT =
  `Znajdujesz "call to action" (CTA) w treści posta na Instagramie - czyli JAWNĄ, wprost wyrażoną zachętę do ` +
  `konkretnego działania widza (np. "napisz w komentarzu", "zapisz sobie ten post", "kliknij link w bio", "oznacz ` +
  `znajomego"). To NIE to samo co hook/pytanie otwierające - samo zadanie pytania widzowi (np. "jak wytłumaczyć ` +
  `komuś, że...?") to hook przyciągający uwagę, a NIE automatycznie zachęta do komentowania - "zachęta do ` +
  `komentarza" wybierz TYLKO gdy pada wyraźne wezwanie do napisania odpowiedzi/opinii w komentarzu (np. "napisz w ` +
  `komentarzu", "odpowiedz poniżej", "daj znać w komentarzu", "a Wy co myślicie? piszcie w komentarzach"), nie ` +
  `gdy jedynym śladem jest sama treść pytania. Jeśli nie ma żadnego jawnego wezwania do działania nigdzie w ` +
  `treści, zwróć "brak wyraźnego CTA" - nie zgaduj CTA na podstawie samego tego, że treść jest angażująca/zadaje ` +
  `pytanie. Dostajesz treść w dwóch oznaczonych sekcjach: PODPIS (tekst napisany pod postem, osobno od samej ` +
  `treści) oraz TREŚĆ GŁÓWNA (to, co faktycznie widać/słychać w samym nagraniu/zdjęciach - transkrypt, tekst na ` +
  `ekranie/zdjęciach). Sprawdź OBIE sekcje osobno. Odpowiadaj WYŁĄCZNIE PO POLSKU. Odpowiedz WYŁĄCZNIE czystym ` +
  `obiektem JSON {"cta": "...", "ctaDetail": "...", "ctaLocation": "..."} bez żadnego innego tekstu. "cta" musi ` +
  `być JEDNĄ z: ${CONTENT_CTAS.join(", ")} (jeśli CTA jest w obu sekcjach, wybierz silniejsze/bardziej ` +
  `wyraźne). "ctaDetail" to DOSŁOWNY cytat całego fragmentu, w którym pada to jawne CTA (nie skracaj go sztucznie ` +
  `do jednego zdania, jeśli CTA rozciąga się na więcej niż jedno zdanie - podaj cały fragment dokładnie tak jak ` +
  `został zapisany/powiedziany) - podaj puste "" gdy "cta" to "brak wyraźnego CTA". "ctaLocation" to JEDNA z: ` +
  `"${CONTENT_CTA_LOCATIONS.join('", "')}" - gdzie dokładnie znalazłeś to CTA ("brak" tylko gdy "cta" to "brak ` +
  `wyraźnego CTA").`;

export async function classifyCtaWithLocation(caption: string, mainContent: string): Promise<CtaWithLocationResult> {
  const combined = [
    caption ? `PODPIS:\n${caption}` : "",
    mainContent ? `TREŚĆ GŁÓWNA:\n${mainContent}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!combined.trim()) return FALLBACK_CTA_WITH_LOCATION;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[content-classification] OPENAI_API_KEY missing - skipping.");
    return FALLBACK_CTA_WITH_LOCATION;
  }

  const client = new OpenAI({ apiKey });
  const completion = await withOpenAiRetry(() => client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CTA_WITH_LOCATION_SYSTEM_PROMPT },
      { role: "user", content: combined.slice(0, 4000) },
    ],
  }));

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return FALLBACK_CTA_WITH_LOCATION;

  try {
    const parsed = JSON.parse(raw);
    return {
      cta: isValid(parsed.cta, CONTENT_CTAS) ? parsed.cta : "inne",
      ctaDetail: typeof parsed.ctaDetail === "string" ? parsed.ctaDetail : "",
      ctaLocation: isValid(parsed.ctaLocation, CONTENT_CTA_LOCATIONS) ? parsed.ctaLocation : "brak",
    };
  } catch {
    console.error("[content-classification] Model returned non-JSON output for CTA-with-location call, using fallback.");
    return FALLBACK_CTA_WITH_LOCATION;
  }
}

interface TopicFormatResult {
  topic: string;
  format: string;
  formatDetail: string;
}

const FALLBACK_TOPIC_FORMAT: TopicFormatResult = { topic: FALLBACK.topic, format: FALLBACK.format, formatDetail: "" };

export async function classifyTopicFormat(text: string): Promise<TopicFormatResult> {
  if (!text.trim()) return FALLBACK_TOPIC_FORMAT;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[content-classification] OPENAI_API_KEY missing - skipping.");
    return FALLBACK_TOPIC_FORMAT;
  }

  const client = new OpenAI({ apiKey });
  const completion = await withOpenAiRetry(() => client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: TOPIC_FORMAT_SYSTEM_PROMPT },
      { role: "user", content: text.slice(0, 4000) },
    ],
  }));

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return FALLBACK_TOPIC_FORMAT;

  try {
    const parsed = JSON.parse(raw);
    return {
      topic: isValid(parsed.topic, CONTENT_TOPICS) ? parsed.topic : "inne",
      format: isValid(parsed.format, CONTENT_FORMATS) ? parsed.format : "inne",
      formatDetail: typeof parsed.formatDetail === "string" ? parsed.formatDetail : "",
    };
  } catch {
    console.error("[content-classification] Model returned non-JSON output for topic/format call, using fallback.");
    return FALLBACK_TOPIC_FORMAT;
  }
}

// Opening-window heuristic: the "hook" is whatever's said in roughly the
// first HOOK_WINDOW_SECONDS of the video, not the whole transcript - falls
// back to the full text if nothing starts within that window (fast cuts / a
// beat of silence at the very start) or there are no segments at all.
export function hookSourceFromTranscript(segments: TranscriptSegment[], fullText: string): string {
  const opening = segments
    .filter((s) => s.start < HOOK_WINDOW_SECONDS)
    .map((s) => s.text)
    .join(" ")
    .trim();
  return opening || fullText;
}

interface InstagramSlideAnalysis {
  source: string;
  description: string;
  extractedText: string;
}

interface InstagramPostForAnalysis {
  id: string;
  caption: string;
  imageUrl: string;
  imageUrls: string[];
  videoUrl: string | null;
  transcript: unknown;
  visualDescription: string | null;
  visualText: string | null;
  slideAnalysis: unknown;
}

// Every carousel slide analyzed separately (not just the cover) so a CTA/
// topic-relevant detail that only appears on e.g. the last slide is still
// found - same rationale as lib/creatorAudit.ts's own per-slide analysis.
// Only ever called once per post (gated by slideAnalysis === null, same
// skip-if-known treatment as transcript/visualDescription below).
async function analyzeAllSlides(imageUrls: string[], postId: string): Promise<InstagramSlideAnalysis[]> {
  const slides: InstagramSlideAnalysis[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const analysis = await analyzeImage(imageUrls[i], `${postId}-slide${i}`);
    if (analysis) {
      slides.push({ source: `slajd ${i + 1}/${imageUrls.length}`, description: analysis.description, extractedText: analysis.extractedText });
    }
  }
  return slides;
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
  let slideAnalysis = post.slideAnalysis as InstagramSlideAnalysis[] | null;

  if (post.videoUrl) {
    if (!transcript) {
      transcript = await transcribeVideo(post.videoUrl, post.id);
      if (transcript) {
        await prisma.scrapedInstagramPost.update({ where: { id: post.id }, data: { transcript: transcript as any } });
      }
    }
    if (visualDescription === null) {
      const frames = await analyzeVideoFrames(post.videoUrl, post.id);
      if (frames) {
        visualDescription = frames.description;
        visualText = frames.extractedText;
        await prisma.scrapedInstagramPost.update({
          where: { id: post.id },
          data: { visualDescription, visualText },
        });
      }
    }
  } else if (post.imageUrls.length > 0) {
    // Hook is judged from the FIRST slide only (the opening moment), same
    // "hook = first thing seen" semantics as videos above - but EVERY slide
    // still gets analyzed below, feeding topic/format/cta instead.
    if (slideAnalysis === null) {
      slideAnalysis = await analyzeAllSlides(post.imageUrls, post.id);
      visualDescription = slideAnalysis[0]?.description ?? "";
      visualText = slideAnalysis[0]?.extractedText ?? "";
      await prisma.scrapedInstagramPost.update({
        where: { id: post.id },
        data: { visualDescription, visualText, slideAnalysis: slideAnalysis as any },
      });
    }
  } else if (visualDescription === null) {
    // Fallback for a post scraped before imageUrls existed - cover only.
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

  // Every slide's text (not just the cover) feeds CTA/topic/format - a CTA or
  // topic-defining detail can sit on any slide, often the last one. Falls
  // back to visualDescription/visualText for videos (no slideAnalysis there,
  // analyzeVideoFrames' combined result is already the full signal).
  const allSlideText = (slideAnalysis ?? []).flatMap((s) => [s.description, s.extractedText]).filter(Boolean).join("\n\n");
  const visualSignal = allSlideText || [visualDescription, visualText].filter(Boolean).join("\n\n");
  const allSignals = [post.caption, transcript?.text, visualSignal].filter(Boolean).join("\n\n");
  const { cta, ctaDetail } = await classifyCta(allSignals);

  const combinedInput = [allSignals, ctaDetail].filter(Boolean).join("\n\n");
  const { topic, format } = await classifyTopicFormat(combinedInput);

  await prisma.scrapedInstagramPost.update({
    where: { id: post.id },
    data: { hookText, hookVisual, cta, ctaDetail, topic, format },
  });
}

// A failure on ONE item (e.g. a stale/expired R2 file for one old post)
// must never block the rest of the batch - without the try/catch here, one
// bad item throws inside the recursive next() chain, which rejects that
// lane's Promise.all entry and aborts the whole call, silently leaving every
// item still queued behind it stuck unclassified (topic stays null forever -
// the next run re-selects the same failing item first and hits the same
// wall again).
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    const current = index++;
    if (current >= items.length) return;
    try {
      await worker(items[current]);
    } catch (err) {
      console.error(`[content-classification] Failed to classify item ${current + 1}/${items.length}:`, err);
    }
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
      imageUrls: true,
      videoUrl: true,
      transcript: true,
      visualDescription: true,
      visualText: true,
      slideAnalysis: true,
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
