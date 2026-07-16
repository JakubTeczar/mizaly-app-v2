// Shared "top of section" AI insight generation for Inspiracje. Newsletter
// is the only source still using this free-text approach - Instagram and
// YouTube moved to structured classification (see lib/contentClassification.ts)
// after a single generated paragraph per scrape turned out not to be
// actionable enough. Pulls a bounded recent sample, asks gpt-4o-mini for a
// professional-quality write-up, and persists it to InspirationAnalysis -
// the newest row per source is what the section's summary panel reads (see
// routes/newsletters.ts).

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
