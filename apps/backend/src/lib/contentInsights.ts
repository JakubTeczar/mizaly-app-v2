// Shared "top of section" AI insight generation for Inspiracje (Instagram /
// YouTube / Newsletter). Each function pulls a bounded recent sample from its
// platform's tables, asks gpt-4o-mini for a professional-quality write-up
// (framed as what a content strategist would want to know before publishing
// their next piece), and persists it to InspirationAnalysis with the
// matching `source` - the newest row per source is what each section's
// summary panel reads (see routes/inspiration.ts, routes/youtubeVideos.ts,
// routes/newsletters.ts).
//
// Deliberately separate from simple numeric ranking (top-3-by-likes etc,
// computed with plain Prisma orderBy in the routes) - that needs no AI call
// at all. This module is only for the parts that genuinely need language
// understanding: emotions, recurring questions, objections, themes.

import OpenAI from "openai";
import { prisma } from "./prisma";

async function callInsightModel(systemPrompt: string, userContent: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[content-insights] OPENAI_API_KEY missing - skipping.");
    return null;
  }

  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() || null;
}

async function saveInsight(source: string, content: string): Promise<void> {
  await prisma.inspirationAnalysis.create({ data: { source, content } });
  console.log(`[content-insights] Stored ${source} insight.`);
}

const INSTAGRAM_SYSTEM_PROMPT =
  "Jesteś doświadczonym strategiem social media, pomagasz twórcom i markom decydować, co publikować dalej. " +
  "Otrzymasz dane o niedawnych postach z Instagrama obserwowanych kont (typ, polubienia, komentarze, wyświetlenia " +
  "wideo, data, fragment opisu) w formacie JSON. Napisz po polsku praktyczną analizę (maksymalnie 300 słów) " +
  "skupioną na tym, co faktycznie przydałoby się twórcy planującemu kolejne treści: które formaty i tematy " +
  "generują najwięcej zaangażowania i dlaczego, jakie wzorce widać w danych, oraz 2-3 konkretne, możliwe do " +
  "wdrożenia wnioski. Pisz zwykłym tekstem, krótkimi akapitami, bez nagłówków markdown i bez długich myślników.";

export async function generateInstagramInsights(): Promise<void> {
  const posts = await prisma.scrapedInstagramPost.findMany({
    orderBy: { postedAt: "desc" },
    take: 50,
  });
  if (posts.length === 0) return;

  const input = posts.map((p) => ({
    username: p.username,
    type: p.type,
    likes: p.likesCount,
    comments: p.commentsCount,
    videoViews: p.videoViewCount,
    postedAt: p.postedAt?.toISOString().slice(0, 10) ?? null,
    caption: p.caption.slice(0, 200),
  }));

  const content = await callInsightModel(INSTAGRAM_SYSTEM_PROMPT, JSON.stringify(input));
  if (content) await saveInsight("instagram", content);
}

const YOUTUBE_SYSTEM_PROMPT =
  "Jesteś doświadczonym strategiem treści wideo, pomagasz twórcom zrozumieć, czego naprawdę chce ich widownia, " +
  "zanim zaczną nagrywać kolejny materiał. Otrzymasz dane o niedawnych filmach (tytuł, wyświetlenia, polubienia, " +
  "liczba komentarzy, data) oraz próbkę rzeczywistych komentarzy widzów pod nimi, w formacie JSON. Napisz po " +
  "polsku praktyczną analizę (maksymalnie 350 słów), która odpowiada na pytania, jakie zadałby sobie profesjonalista " +
  "przed publikacją: jakie emocje wywołują te treści u widzów (entuzjazm, frustracja, ciekawość, sceptycyzm), jakie " +
  "pytania i wątpliwości najczęściej się powtarzają w komentarzach, jakich tematów lub obiekcji jeszcze nikt nie " +
  "poruszył a warto by je adresować, oraz które formaty i tematy filmów generują najsilniejszą reakcję. Zakończ " +
  "2-3 konkretnymi pomysłami na kolejny materiał, wynikającymi wprost z tych danych. Pisz zwykłym tekstem, krótkimi " +
  "akapitami, bez nagłówków markdown i bez długich myślników.";

// Comments per video are capped to a representative sample here (top by
// likes), not the full stored set - a viral video can have thousands of
// rows and we need to keep the prompt within a sane token budget. Full
// comment history still lives in the DB regardless (see youtubeScrapeJob.ts).
const YOUTUBE_COMMENTS_PER_VIDEO_SAMPLE = 25;

export async function generateYoutubeInsights(): Promise<void> {
  const videos = await prisma.scrapedYoutubeVideo.findMany({
    orderBy: { publishedAt: "desc" },
    take: 20,
    include: {
      comments: {
        orderBy: { likeCount: "desc" },
        take: YOUTUBE_COMMENTS_PER_VIDEO_SAMPLE,
      },
    },
  });
  if (videos.length === 0) return;

  const input = videos.map((v) => ({
    channel: v.channelHandle,
    title: v.title,
    views: v.viewCount,
    likes: v.likeCount,
    commentCount: v.commentCount,
    publishedAt: v.publishedAt?.toISOString().slice(0, 10) ?? null,
    topComments: v.comments.map((c) => ({ text: c.text, likes: c.likeCount })),
  }));

  const content = await callInsightModel(YOUTUBE_SYSTEM_PROMPT, JSON.stringify(input));
  if (content) await saveInsight("youtube", content);
}

const NEWSLETTER_SYSTEM_PROMPT =
  "Jesteś doświadczonym analitykiem treści branżowych, pomagasz twórcom być na bieżąco z tym, o czym pisze " +
  "branża, zanim sami stworzą kolejny materiał. Otrzymasz temat, nadawcę i fragment treści niedawno odebranych " +
  "newsletterów, w formacie JSON. Napisz po polsku zwięzłą analizę (maksymalnie 300 słów): jakie tematy i wątki " +
  "powtarzają się najczęściej, jakie podejścia lub kąty warto rozważyć w oparciu o to, co porusza branża, oraz " +
  "2-3 konkretne pomysły na treść inspirowane tym, co się pojawiło. Pisz zwykłym tekstem, krótkimi akapitami, " +
  "bez nagłówków markdown i bez długich myślników.";

function plainTextSnippet(bodyText: string | null, bodyHtml: string | null, maxLength = 400): string {
  const source = bodyText || (bodyHtml ? bodyHtml.replace(/<[^>]+>/g, " ") : "");
  return source.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export async function generateNewsletterInsights(): Promise<void> {
  const newsletters = await prisma.newsletterEmail.findMany({
    orderBy: { receivedAt: "desc" },
    take: 15,
  });
  if (newsletters.length === 0) return;

  const input = newsletters.map((n) => ({
    subject: n.subject,
    from: n.fromName || n.fromAddress,
    receivedAt: n.receivedAt.toISOString().slice(0, 10),
    snippet: plainTextSnippet(n.bodyText, n.bodyHtml),
  }));

  const content = await callInsightModel(NEWSLETTER_SYSTEM_PROMPT, JSON.stringify(input));
  if (content) await saveInsight("newsletter", content);
}
