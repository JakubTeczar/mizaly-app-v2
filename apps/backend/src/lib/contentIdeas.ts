// Turns the same classification-group rankings shown in ClassificationRanking
// (Inspiracje > "Co działa najlepiej") into concrete, actionable content ideas
// via gpt-4o-mini - structured JSON like lib/contentClassification.ts, not
// free text like lib/contentInsights.ts (a single paragraph turned out not to
// be actionable enough, same lesson that moved Instagram/YouTube analysis
// there to structured classification in the first place). Runs at the end of
// each scrape job (see jobs/inspirationScrapeJob.ts, jobs/youtubeScrapeJob.ts)
// so it refreshes on the same ~24h cadence as the rest of the scraped data,
// and is cached in ContentIdeaSet - the newest row per source is what the app
// shows (see routes/inspiration.ts, routes/youtubeVideos.ts).

import OpenAI from "openai";
import { prisma } from "./prisma";
import { computeNormalizedScores } from "./engagementNormalization";

// Same threshold as ClassificationRanking.tsx's rankBy() on the frontend - a
// group backed by a single mature post isn't a pattern worth basing a content
// idea on.
const MIN_GROUP_SIZE = 2;
const MAX_GROUPS = 5;
const MAX_IDEAS = 10;

interface RankedGroup {
  axis: string;
  label: string;
  avgRatio: number;
  count: number;
}

// Port of ClassificationRanking.tsx's rankBy(), generalized across axes at
// once instead of one axis at a time - the job has no notion of "the axis
// tab the user currently has open", so it ranks every axis together and lets
// the LLM pick which groups are worth turning into ideas.
function rankGroups(entries: { axis: string; label: string; ratio: number }[]): RankedGroup[] {
  const byKey = new Map<string, { axis: string; label: string; ratios: number[] }>();
  for (const entry of entries) {
    const key = `${entry.axis}:${entry.label}`;
    const existing = byKey.get(key);
    if (existing) existing.ratios.push(entry.ratio);
    else byKey.set(key, { axis: entry.axis, label: entry.label, ratios: [entry.ratio] });
  }
  return Array.from(byKey.values())
    .map(({ axis, label, ratios }) => ({
      axis,
      label,
      avgRatio: ratios.reduce((sum, r) => sum + r, 0) / ratios.length,
      count: ratios.length,
    }))
    .filter((group) => group.count >= MIN_GROUP_SIZE)
    .sort((a, b) => b.avgRatio - a.avgRatio);
}

interface TopItem {
  label: string;
  ratio: number;
  excerpt: string;
}

interface Idea {
  title: string;
  rationale: string;
}

function buildSystemPrompt(platformLabel: string): string {
  return (
    `Jesteś strategiem social media dla marki publikującej na ${platformLabel}. Otrzymasz dane o tym, jakie ` +
    `kategorie treści i konkretne posty ostatnio działały najlepiej, mierzone jako wielokrotność zwykłego tempa ` +
    `zaangażowania danego konta/kanału (1.0 to jego typowe tempo, 2.0 to dwa razy szybsze niż zwykle). Na tej ` +
    `podstawie zaproponuj dokładnie 10 konkretnych pomysłów na kolejne treści do nagrania, opartych na tych ` +
    `danych, nie ogólnikowych porad w stylu "publikuj częściej". Odpowiedz WYŁĄCZNIE czystym obiektem JSON ` +
    `{"ideas": [{"title": "...", "rationale": "..."}]} z dokładnie 10 elementami, bez żadnego innego tekstu. ` +
    `"title" to krótkie (maksymalnie 1 zdanie), konkretne działanie do wykonania, np. "Nagraj X w formacie Y". ` +
    `"rationale" to jedno zdanie wyjaśniające, na której grupie lub poście z danych się opiera. Pisz po polsku, ` +
    `zwykłym tekstem, bez długich myślników - używaj przecinków lub kropek zamiast nich.`
  );
}

async function callIdeasModel(
  platformLabel: string,
  topGroups: RankedGroup[],
  topItems: TopItem[]
): Promise<Idea[] | null> {
  if (topGroups.length === 0 && topItems.length === 0) return null;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[content-ideas] OPENAI_API_KEY missing - skipping.");
    return null;
  }

  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt(platformLabel) },
      { role: "user", content: JSON.stringify({ topGroups, topItems }) },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.ideas)) return null;
    const ideas = parsed.ideas.filter(
      (idea: unknown): idea is Idea =>
        Boolean(idea) && typeof (idea as Idea).title === "string" && typeof (idea as Idea).rationale === "string"
    );
    return ideas.slice(0, MAX_IDEAS);
  } catch {
    console.error("[content-ideas] Model returned non-JSON output, skipping.");
    return null;
  }
}

async function saveIdeas(source: string, ideas: Idea[]): Promise<void> {
  await prisma.contentIdeaSet.create({ data: { source, ideas: ideas as any } });
  console.log(`[content-ideas] Stored ${ideas.length} ${source} idea(s).`);
}

const INSTAGRAM_AXES = ["topic", "format", "hook", "cta"] as const;

export async function generateInstagramContentIdeas(): Promise<void> {
  const watchedUsernames = (await prisma.watchedInstagramAccount.findMany()).map((a) => a.username);
  const posts = await prisma.scrapedInstagramPost.findMany({
    where: { username: { in: watchedUsernames }, topic: { not: null } },
  });
  if (posts.length === 0) return;

  // Same getEngagement/getGroupKey as routes/inspiration.ts's /trends
  // endpoint - keeps outlierRatio here consistent with what "Top 3"/"Co
  // działa najlepiej" already show for the same posts.
  const scores = computeNormalizedScores(posts, {
    getEngagement: (p) => p.likesCount + p.commentsCount + (p.videoViewCount ?? 0) / 10,
    getPostedAt: (p) => p.postedAt,
    getGroupKey: (p) => p.username,
  });

  const entries: { axis: string; label: string; ratio: number }[] = [];
  for (const post of posts) {
    const score = scores.get(post)!;
    if (!score.isMature || typeof score.outlierRatio !== "number") continue;
    for (const axis of INSTAGRAM_AXES) {
      const label = post[axis];
      if (!label || label === "inne") continue;
      entries.push({ axis, label, ratio: score.outlierRatio });
    }
  }
  const topGroups = rankGroups(entries).slice(0, MAX_GROUPS);

  const topItems: TopItem[] = posts
    .map((post) => ({ post, score: scores.get(post)! }))
    .filter(({ score }) => score.isMature && typeof score.outlierRatio === "number")
    .sort((a, b) => (b.score.outlierRatio as number) - (a.score.outlierRatio as number))
    .slice(0, 3)
    .map(({ post, score }) => ({
      label: `@${post.username}`,
      ratio: score.outlierRatio as number,
      excerpt: (post.caption || "").slice(0, 200),
    }));

  const ideas = await callIdeasModel("Instagramie", topGroups, topItems);
  if (ideas) await saveIdeas("instagram", ideas);
}

const YOUTUBE_AXES = ["topic", "format", "hook"] as const;

export async function generateYoutubeContentIdeas(): Promise<void> {
  const channelHandles = (await prisma.watchedYoutubeChannel.findMany()).map((c) => c.handle);
  const videos = await prisma.scrapedYoutubeVideo.findMany({
    where: { channelHandle: { in: channelHandles }, topic: { not: null } },
  });
  if (videos.length === 0) return;

  // Same getEngagement/getGroupKey as routes/youtubeVideos.ts's main list
  // endpoint - keeps outlierRatio consistent with what the section already shows.
  const scores = computeNormalizedScores(videos, {
    getEngagement: (v) => v.likeCount + v.commentCount + v.viewCount / 10,
    getPostedAt: (v) => v.publishedAt,
    getGroupKey: (v) => v.channelHandle,
  });

  const entries: { axis: string; label: string; ratio: number }[] = [];
  for (const video of videos) {
    const score = scores.get(video)!;
    if (!score.isMature || typeof score.outlierRatio !== "number") continue;
    for (const axis of YOUTUBE_AXES) {
      const label = video[axis];
      if (!label || label === "inne") continue;
      entries.push({ axis, label, ratio: score.outlierRatio });
    }
  }
  const topGroups = rankGroups(entries).slice(0, MAX_GROUPS);

  const topItems: TopItem[] = videos
    .map((video) => ({ video, score: scores.get(video)! }))
    .filter(({ score }) => score.isMature && typeof score.outlierRatio === "number")
    .sort((a, b) => (b.score.outlierRatio as number) - (a.score.outlierRatio as number))
    .slice(0, 3)
    .map(({ video, score }) => ({
      label: `@${video.channelHandle}`,
      ratio: score.outlierRatio as number,
      excerpt: video.title.slice(0, 200),
    }));

  const ideas = await callIdeasModel("YouTube", topGroups, topItems);
  if (ideas) await saveIdeas("youtube", ideas);
}
