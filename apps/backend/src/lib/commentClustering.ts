// Groups audience comments (Instagram AND YouTube) by topic for the
// Inspiracje "Segmentacja komentarzy" section - NOT one giant GPT prompt over
// raw comments (expensive, non-deterministic, drowns in noise). Instead: a
// cheap regex pre-filter drops pure reactions ("🔥🔥🔥", "super!", "@ktoś
// zobacz to"), the rest gets embedded (OpenAI text-embedding-3-small) and
// grouped with DBSCAN (see lib/clustering.ts) - a real, deterministic,
// countable grouping by semantic similarity. GPT only touches the ALREADY-
// GROUPED clusters at the very end, once, to give each a short human-readable
// label AND flag any cluster that's still just reactions the regex pre-filter
// missed (dropped entirely, not shown with a "komplementy/reakcje" label
// eating a slot meant for a real topic - see MAX_CLUSTERS_TO_LABEL below).
// Runs at the end of each scrape job (see jobs/inspirationScrapeJob.ts,
// jobs/youtubeScrapeJob.ts), cached in CommentClusterSet like
// lib/contentIdeas.ts's ContentIdeaSet.
//
// Three lenses are generated per platform ("instagram"/"instagram_questions"/
// "instagram_pain_points" and their "youtube_*" siblings): all non-reaction
// comments, just the subset that reads as an actual question (see
// isQuestionComment), and just the subset that reads as frustration/struggle
// (see isPainPointComment) - the latter two are much higher-signal than
// general topic clusters when the goal is specifically "what do people ask"
// or "what's hard for them", since even after dropping reactions, plain topic
// clusters still mix opinions/stories/questions/complaints together.

import OpenAI from "openai";
import { prisma } from "./prisma";
import { withOpenAiRetry } from "./openaiRetry";
import { dbscanCluster } from "./clustering";

// Covers the common emoji blocks actually seen in Instagram comments
// (emoticons, symbols/pictographs, dingbats, transport, flags) - doesn't need
// to be exhaustive, just enough that a comment made ONLY of emoji reduces to
// an empty string below.
const EMOJI_REGEX =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu;
const MENTION_REGEX = /@[\w.]+/g;

// Common Polish reaction-only phrases (no question/content, pure praise) -
// checked against the comment AFTER emoji/mentions are stripped, so "super
// 🔥🔥" and "@kolega super" both still match "super". This is a first, cheap
// pass only - it will NOT catch every reaction (e.g. a compliment padded with
// a few extra words), so labelClusters below does a second, semantic pass on
// whatever slips through as its own cluster.
const REACTION_ONLY_PHRASES = [
  /^super!*$/i,
  /^extra!*$/i,
  /^ekstra!*$/i,
  /^swietnie!*$/i,
  /^świetne!*$/i,
  /^świetnie!*$/i,
  /^brawo!*$/i,
  /^spoko!*$/i,
  /^git!*$/i,
  /^wow!*$/i,
  /^rewelacja!*$/i,
  /^petarda!*$/i,
  /^ogień!*$/i,
  /^mega!*$/i,
  /^love!*$/i,
  /^piekne!*$/i,
  /^pieknie!*$/i,
];

// Below this many actual letters/digits (after stripping emoji/mentions),
// there's not enough left to carry any real topic/question - drop it as a
// reaction. Tunable if real output shows this cutting too much/little.
const MIN_MEANINGFUL_CHARS = 10;

export function isReactionOnlyComment(text: string): boolean {
  const withoutMentions = text.replace(MENTION_REGEX, " ");
  const withoutEmoji = withoutMentions.replace(EMOJI_REGEX, " ");
  const collapsed = withoutEmoji.replace(/\s+/g, " ").trim();
  if (!collapsed) return true;

  const alnumCount = (collapsed.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (alnumCount < MIN_MEANINGFUL_CHARS) return true;

  return REACTION_ONLY_PHRASES.some((re) => re.test(collapsed));
}

// A "?" is the strongest signal; a handful of Polish question-opening words
// without one still counts UNLESS the comment reads like a statement (ends
// in "!" or "."), which is mostly exclamations like "Jak super!".
const QUESTION_OPENERS =
  /^(jak|co|czy|dlaczego|kiedy|ile|gdzie|po co|skad|skąd|kto|kto[m]?u|kt[oó]ry|kt[oó]ra|kt[oó]re|jaki|jaka|jakie)\b/i;
// "Jak zawsze"/"jak zwykle" etc. are idioms ("as always"), not the
// interrogative "jak" (how) - without this exception they false-positive as
// questions constantly (Polish compliments routinely open with them).
const QUESTION_OPENER_IDIOM_EXCEPTIONS = /^jak (zawsze|zwykle|widac|widać)\b/i;

export function isQuestionComment(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.includes("?")) return true;
  if (QUESTION_OPENER_IDIOM_EXCEPTIONS.test(trimmed)) return false;
  return QUESTION_OPENERS.test(trimmed) && !/[!.]\s*$/.test(trimmed);
}

// Common Polish frustration/struggle phrasing - checked as a substring
// anywhere in the comment (unlike QUESTION_OPENERS, a pain point is rarely
// the very first word: "Od miesięcy walczę z tym samym problemem..."). Each
// covers both the diacritic and no-diacritic spelling, since Instagram
// commenters routinely drop Polish diacritics on mobile keyboards. Fuzzier
// and lower-precision than isQuestionComment (no reliable marker like "?"),
// tunable if real output shows this cutting too much/little.
const PAIN_POINT_PHRASES = [
  /nie mog[eę]/i,
  /nie potrafi[eę]/i,
  /nie wiem jak/i,
  /nie umiem/i,
  /nie wychodzi mi/i,
  /nie dzia[lł]a/i,
  /walcz[eę] z/i,
  /zmagam si[eę] z/i,
  /boryka(m|my) si[eę]/i,
  /mam problem/i,
  /ci[eę]żko mi|ciezko mi/i,
  /trudno mi/i,
  /utkn[eę]([lł]am|[lł]em)/i,
  /poddaj[eę] si[eę]/i,
  /sfrustrowan/i,
  /frustruje/i,
  /nie daj[eę] rady/i,
  /nie radz[eę] sobie/i,
  /brakuje mi/i,
];

// "Nie mam problemu z tym" ("I don't have a problem with that") means the
// OPPOSITE of a pain point, but literally contains "mam problem" - without
// this exception it constantly false-positives.
const PAIN_POINT_NEGATION_EXCEPTIONS = /nie mam(\s+\S+){0,3}\s+problem/i;

export function isPainPointComment(text: string): boolean {
  if (PAIN_POINT_NEGATION_EXCEPTIONS.test(text)) return false;
  return PAIN_POINT_PHRASES.some((re) => re.test(text));
}

// Effectively "all of them" at this feature's current scale (~12k total,
// well under this) - ordered by recency (not likeCount) so a low-liked but
// common question isn't systematically excluded before it even gets a chance
// to cluster with others like it. Still capped, not removed entirely: DBSCAN
// below is O(n^2), so this is the safety valve once volume grows well past
// what a few-thousand-comment daily job should spend on clustering.
const MAX_COMMENTS_FOR_CLUSTERING = 20000;
// DBSCAN knobs - cosine similarity floor and minimum neighborhood size.
// Starting point, not derived from a tuning run against real output; revisit
// if clusters come out too broad (lower MIN_SIMILARITY) or too fragmented
// (raise it).
const MIN_SIMILARITY = 0.72;
const MIN_CLUSTER_SIZE = 3;
// Smaller than the model's default 1536 - halves the O(n^2 * d) DBSCAN cost
// for a small, well-documented quality tradeoff (OpenAI's own guidance on
// shortening text-embedding-3 vectors via `dimensions`).
const EMBEDDING_DIMENSIONS = 512;
// How many of the largest clusters actually get shown - MAX_CLUSTERS_TO_LABEL
// is deliberately larger, since some of the largest clusters get dropped
// after labeling flags them as pure reactions (see labelClusters), and the
// display should still end up with a full page of real topics, not fewer.
const MAX_CLUSTERS_TO_SHOW = 10;
const MAX_CLUSTERS_TO_LABEL = 25;
// Per cluster, how many of its comments get stored/shown (not just a single
// example) - the UI lets you scroll/expand through these. Capped well below
// a cluster's real `count` for the biggest groups so the payload stays
// reasonable; the UI shows the true count alongside whatever's truncated.
const MAX_COMMENTS_STORED_PER_CLUSTER = 30;

export interface CommentClusterExample {
  text: string;
  postUrl: string;
}

export interface CommentCluster {
  label: string;
  count: number;
  exampleComments: CommentClusterExample[];
}

// A comment plus which post it came from - carried alongside the comment
// text through embedding/clustering so the UI can link an example comment
// back to its source post (clustering/labeling only ever look at `.text`).
interface CommentCandidate {
  text: string;
  postUrl: string;
}

async function embedTexts(texts: string[], apiKey: string): Promise<number[][]> {
  const client = new OpenAI({ apiKey });
  const vectors: number[][] = [];
  const BATCH_SIZE = 100;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const chunk = texts.slice(i, i + BATCH_SIZE).map((t) => t.slice(0, 500));
    const response = await withOpenAiRetry(() =>
      client.embeddings.create({
        model: "text-embedding-3-small",
        input: chunk,
        dimensions: EMBEDDING_DIMENSIONS,
      })
    );
    for (const item of response.data) vectors.push(item.embedding);
  }

  return vectors;
}

const CLUSTER_LABEL_SYSTEM_PROMPT =
  `Dostajesz listę grup (klastrów) komentarzy z Instagrama - każda z liczbą komentarzy i kilkoma przykładami. ` +
  `Dla KAŻDEJ grupy oceń, czy to grupa z realną treścią (pytanie, opinia, historia, prośba, temat) czy grupa, ` +
  `która jest WYŁĄCZNIE reakcją/komplementem bez żadnej konkretnej treści (np. "super rolka", "🔥", "brawo", ` +
  `"kocham to konto") - jeśli WYŁĄCZNIE reakcja, ustaw "isReactionOnly": true. Dla każdej grupy napisz też krótką ` +
  `(2-5 słów), konkretną etykietę po polsku opisującą wspólny temat/typ (np. "pytania o dietę", "prośby o link do ` +
  `sprzętu", "pytania o cenę/ofertę", "krytyka reklam alkoholu") - dla grup z isReactionOnly=true wpisz po prostu ` +
  `"komplementy/reakcje". Odpowiedz WYŁĄCZNIE czystym obiektem JSON {"labels": [{"index": 0, "label": "...", ` +
  `"isReactionOnly": false}, ...]} z dokładnie jednym wpisem na każdą podaną grupę (używając tego samego "index" ` +
  `co w danych wejściowych), bez żadnego innego tekstu. Pisz zwykłym tekstem, bez długich myślników - użyj ` +
  `przecinków lub kropek zamiast nich.`;

interface ClusterLabelResult {
  label: string;
  isReactionOnly: boolean;
}

async function labelClusters(clusters: string[][], apiKey: string): Promise<ClusterLabelResult[]> {
  const fallback = clusters.map((_, i) => ({ label: `Grupa ${i + 1}`, isReactionOnly: false }));

  const client = new OpenAI({ apiKey });
  const payload = clusters.map((comments, index) => ({
    index,
    count: comments.length,
    examples: comments.slice(0, 5),
  }));

  const completion = await withOpenAiRetry(() =>
    client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CLUSTER_LABEL_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
    })
  );

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    const byIndex = new Map<number, ClusterLabelResult>();
    if (Array.isArray(parsed.labels)) {
      for (const entry of parsed.labels) {
        if (typeof entry?.index === "number" && typeof entry?.label === "string") {
          byIndex.set(entry.index, { label: entry.label, isReactionOnly: entry.isReactionOnly === true });
        }
      }
    }
    return clusters.map((_, i) => byIndex.get(i) ?? fallback[i]);
  } catch {
    console.error("[comment-clustering] Model returned non-JSON output for cluster labeling, using fallback labels.");
    return fallback;
  }
}

async function saveClusters(source: string, clusters: CommentCluster[]): Promise<void> {
  await prisma.commentClusterSet.create({ data: { source, clusters: clusters as any } });
  console.log(`[comment-clustering] Stored ${clusters.length} cluster(s) for source "${source}".`);
}

// Shared by both entry points below - embeds, clusters, labels (dropping
// reaction-only clusters), and saves. `candidateTexts` is already filtered to
// whatever subset this source cares about (all non-reaction comments, or just
// questions).
//
// DBSCAN drops anything without >=minClusterSize close semantic neighbors as
// "noise" - correct for the general topic view (a one-off stray comment
// isn't a pattern worth surfacing), but wrong for the questions view: most
// real questions are each phrased uniquely even when they're about the same
// rough thing, so with the default settings ~99% of real questions got
// silently discarded as noise instead of shown. `includeUnclusteredBucket`
// appends whatever's left as one final, honestly-labeled "hasn't repeated
// (yet)" bucket instead of throwing it away - see generateInstagramQuestionClusters.
async function runClusteringPipeline(
  source: string,
  candidates: CommentCandidate[],
  options?: { minClusterSize?: number; minSimilarity?: number; unclusteredBucketLabel?: string }
): Promise<void> {
  const minClusterSize = options?.minClusterSize ?? MIN_CLUSTER_SIZE;
  const minSimilarity = options?.minSimilarity ?? MIN_SIMILARITY;

  if (candidates.length < minClusterSize) {
    await saveClusters(source, []);
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[comment-clustering] OPENAI_API_KEY missing - skipping.");
    return;
  }

  const vectors = await embedTexts(candidates.map((c) => c.text), apiKey);
  const clusterIds = dbscanCluster(vectors, minSimilarity, minClusterSize);

  const byCluster = new Map<number, CommentCandidate[]>();
  const unclustered: CommentCandidate[] = [];
  clusterIds.forEach((clusterId, i) => {
    if (clusterId < 0) {
      unclustered.push(candidates[i]); // noise - didn't join any dense-enough group
      return;
    }
    const list = byCluster.get(clusterId) ?? [];
    list.push(candidates[i]);
    byCluster.set(clusterId, list);
  });

  const rankedCandidates = Array.from(byCluster.values())
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_CLUSTERS_TO_LABEL);

  let clusters: CommentCluster[] = [];
  if (rankedCandidates.length > 0) {
    const labeled = await labelClusters(
      rankedCandidates.map((group) => group.map((c) => c.text)),
      apiKey
    );
    clusters = rankedCandidates
      .map((comments, i) => ({ comments, ...labeled[i] }))
      .filter((c) => !c.isReactionOnly)
      .slice(0, MAX_CLUSTERS_TO_SHOW)
      .map(({ comments, label }) => ({
        label,
        count: comments.length,
        exampleComments: comments.slice(0, MAX_COMMENTS_STORED_PER_CLUSTER),
      }));
  }

  // unclustered.push() preserves candidates' original order (newest first,
  // see loadWatchedComments), so the stored slice is already "most recent
  // unclustered" ones, not an arbitrary sample.
  if (options?.unclusteredBucketLabel && unclustered.length > 0) {
    clusters.push({
      label: options.unclusteredBucketLabel,
      count: unclustered.length,
      exampleComments: unclustered.slice(0, MAX_COMMENTS_STORED_PER_CLUSTER),
    });
  }

  await saveClusters(source, clusters);
}

async function loadWatchedComments(): Promise<CommentCandidate[]> {
  const watchedUsernames = (await prisma.watchedInstagramAccount.findMany()).map((a) => a.username);
  if (watchedUsernames.length === 0) return [];

  const posts = await prisma.scrapedInstagramPost.findMany({
    where: { username: { in: watchedUsernames } },
    select: { id: true },
  });
  if (posts.length === 0) return [];

  const comments = await prisma.scrapedInstagramComment.findMany({
    where: { postId: { in: posts.map((p) => p.id) } },
    orderBy: { postedAt: "desc" },
    take: MAX_COMMENTS_FOR_CLUSTERING,
    select: { text: true, post: { select: { url: true } } },
  });
  return comments
    .filter((c) => c.text)
    .map((c) => ({ text: c.text, postUrl: c.post.url }));
}

// Global (not organization-scoped) - same rationale as the rest of the
// Inspiracje watchlist pipeline (see ScrapedInstagramPost's schema comment).
export async function generateInstagramCommentClusters(): Promise<void> {
  const allComments = await loadWatchedComments();
  if (allComments.length === 0) return;
  const candidates = allComments.filter((c) => !isReactionOnlyComment(c.text));
  await runClusteringPipeline("instagram", candidates);
}

// Same comment pool as above, but scoped to comments that read as an actual
// question (see isQuestionComment) - a much higher-signal view than general
// topic clusters when the goal is specifically "what does the audience ask".
// Looser DBSCAN settings than the general topic view (a pair of near-
// identical questions is already a real repeat worth surfacing, unlike two
// near-identical general comments) plus unclusteredBucketLabel, since
// questions are far more likely to each be uniquely phrased than general
// comments - without it, the vast majority of real questions were silently
// dropped as "noise" instead of shown at all.
export async function generateInstagramQuestionClusters(): Promise<void> {
  const allComments = await loadWatchedComments();
  if (allComments.length === 0) return;
  const candidates = allComments.filter((c) => isQuestionComment(c.text) && !isReactionOnlyComment(c.text));
  await runClusteringPipeline("instagram_questions", candidates, {
    minClusterSize: 2,
    minSimilarity: 0.68,
    unclusteredBucketLabel: "Pojedyncze pytania (jeszcze się nie powtórzyły)",
  });
}

// Same idea as generateInstagramQuestionClusters, scoped to comments that
// read as frustration/struggle (see isPainPointComment) instead of a
// question - "what's hard for the audience" rather than "what do they ask".
// A comment can match both filters (a frustrated question), and will appear
// in both views - they're independent lenses on the same pool, not a
// partition.
export async function generateInstagramPainPointClusters(): Promise<void> {
  const allComments = await loadWatchedComments();
  if (allComments.length === 0) return;
  const candidates = allComments.filter((c) => isPainPointComment(c.text) && !isReactionOnlyComment(c.text));
  await runClusteringPipeline("instagram_pain_points", candidates, {
    minClusterSize: 2,
    minSimilarity: 0.68,
    unclusteredBucketLabel: "Pojedyncze zgłoszenia (jeszcze się nie powtórzyły)",
  });
}

// ---------- YouTube (same pipeline, different source table) ----------

async function loadWatchedYoutubeComments(): Promise<CommentCandidate[]> {
  const channelHandles = (await prisma.watchedYoutubeChannel.findMany()).map((c) => c.handle);
  if (channelHandles.length === 0) return [];

  const videos = await prisma.scrapedYoutubeVideo.findMany({
    where: { channelHandle: { in: channelHandles } },
    select: { id: true },
  });
  if (videos.length === 0) return [];

  const comments = await prisma.scrapedYoutubeComment.findMany({
    where: { videoId: { in: videos.map((v) => v.id) } },
    orderBy: { postedAt: "desc" },
    take: MAX_COMMENTS_FOR_CLUSTERING,
    select: { text: true, videoId: true },
  });
  return comments
    .filter((c) => c.text)
    .map((c) => ({ text: c.text, postUrl: `https://www.youtube.com/watch?v=${c.videoId}` }));
}

export async function generateYoutubeCommentClusters(): Promise<void> {
  const allComments = await loadWatchedYoutubeComments();
  if (allComments.length === 0) return;
  const candidates = allComments.filter((c) => !isReactionOnlyComment(c.text));
  await runClusteringPipeline("youtube", candidates);
}

export async function generateYoutubeQuestionClusters(): Promise<void> {
  const allComments = await loadWatchedYoutubeComments();
  if (allComments.length === 0) return;
  const candidates = allComments.filter((c) => isQuestionComment(c.text) && !isReactionOnlyComment(c.text));
  await runClusteringPipeline("youtube_questions", candidates, {
    minClusterSize: 2,
    minSimilarity: 0.68,
    unclusteredBucketLabel: "Pojedyncze pytania (jeszcze się nie powtórzyły)",
  });
}

export async function generateYoutubePainPointClusters(): Promise<void> {
  const allComments = await loadWatchedYoutubeComments();
  if (allComments.length === 0) return;
  const candidates = allComments.filter((c) => isPainPointComment(c.text) && !isReactionOnlyComment(c.text));
  await runClusteringPipeline("youtube_pain_points", candidates, {
    minClusterSize: 2,
    minSimilarity: 0.68,
    unclusteredBucketLabel: "Pojedyncze zgłoszenia (jeszcze się nie powtórzyły)",
  });
}
