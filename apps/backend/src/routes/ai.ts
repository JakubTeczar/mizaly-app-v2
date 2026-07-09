import { Router } from "express";
import OpenAI from "openai";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import { prisma } from "../lib/prisma";

const router = Router();

router.use(requireAuth);

const generateCaptionSchema = z.object({
  topic: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
});

const SYSTEM_PROMPT =
  "Jesteś asystentem tworzącym posty social media dla polskiego odbiorcy. " +
  "Napisz krótki, chwytliwy tytuł, angażujący podpis (caption) w języku polskim oraz kilka trafnych hashtagów. " +
  "Nie używaj długich myślników (znak „—”). " +
  'Odpowiedz WYŁĄCZNIE w formacie JSON: {"title": string, "caption": string, "hashtags": string[]}, bez żadnego dodatkowego tekstu.';

router.post(
  "/generate-caption",
  asyncHandler(async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "OpenAI API key nie jest skonfigurowany." });
      return;
    }

    const { topic, prompt } = generateCaptionSchema.parse(req.body);
    const userPrompt = prompt ?? topic;
    if (!userPrompt) {
      res.status(400).json({ error: "Wymagane pole 'topic' lub 'prompt'." });
      return;
    }

    const client = new OpenAI({ apiKey });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";

    let parsed: { title?: string; caption?: string; hashtags?: string[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { caption: raw, hashtags: [] };
    }

    res.json({
      title: parsed.title ?? "",
      caption: parsed.caption ?? "",
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
    });
  })
);

// "Dokładny" (precise) generation mode: instead of generating straight from a
// one-line topic, the model interviews the user one question at a time (each
// with pick-list options) until it's ≥95% confident it knows what would make
// the post actually interesting, then returns the final caption. Stateless -
// the client resends the full history each turn instead of us persisting a
// conversation server-side.
const interviewHistoryItemSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).default([]),
  answer: z.string().min(1),
});

const interviewSchema = z.object({
  topic: z.string().min(1),
  history: z.array(interviewHistoryItemSchema).default([]),
});

const MAX_INTERVIEW_QUESTIONS = 6;

const INTERVIEW_SYSTEM_PROMPT =
  "Jesteś ekspertem od tworzenia angażujących postów social media dla polskiego odbiorcy. " +
  "Użytkownik podał temat, o którym chce napisać post. Twoim zadaniem jest zadać mu kilka krótkich " +
  "pytań, jedno na raz, żeby wyciągnąć OD NIEGO konkretne informacje potrzebne do napisania " +
  "nieszablonowego, chwytliwego posta.\n\n" +
  "Pytaj o rzeczy, które zna tylko użytkownik, np.:\n" +
  "- jaki to ma być typ posta (edukacyjny, o sobie/osobisty, sprzedażowy, promocyjny, motywacyjny, inny),\n" +
  "- jakie dokładnie informacje albo szczegóły chce zawrzeć w treści,\n" +
  "- jakie ma własne doświadczenie, historię, wynik albo opinię związaną z tematem,\n" +
  "- jaki konkretny cel albo przekaz chce przekazać,\n" +
  "- do kogo kieruje post (grupa docelowa) i jaki problem lub potrzebę tej grupy porusza,\n" +
  "- jaki ton i styl chce zastosować (np. eksperckie, luźne, motywacyjne, sprzedażowe),\n" +
  "- czy chce zawrzeć wezwanie do działania (CTA) i jakie (komentarz, zapis, kontakt, zakup, obserwuj).\n\n" +
  "Zasady:\n" +
  "1. Jeśli temat podany przez użytkownika już jasno określa cel albo typ posta (np. „chciałbym " +
  "stworzyć posta sprzedażowego o X”), potraktuj to jako ustalone i nie pytaj o to ponownie. W " +
  "przeciwnym razie PIERWSZE pytanie ma dotyczyć celu/typu posta, zanim przejdziesz do bardziej " +
  "szczegółowych pytań.\n" +
  "2. Możesz dostać dodatkową wiadomość systemową „Kontekst o użytkowniku”. Potraktuj zawarte tam " +
  "informacje jako już znane i nigdy nie pytaj o rzeczy, które ten kontekst już wyjaśnia.\n" +
  "3. Zadawaj TYLKO JEDNO pytanie na raz, sformułowane wprost do użytkownika, np. \"Jakie masz " +
  "doświadczenie z...\" albo \"Co ma zapamiętać czytelnik po przeczytaniu posta?\".\n" +
  "4. Nigdy nie zgaduj faktów, liczb ani historii za użytkownika i nie proponuj ich w opcjach jako " +
  "gotowych do zaakceptowania. Opcje odpowiedzi to różne KIERUNKI wyboru (np. różne tony, cele, grupy " +
  "odbiorców, rodzaje doświadczeń), nie gotowe treści.\n" +
  "5. Do każdego pytania dołącz od 3 do 5 krótkich opcji odpowiedzi (kilka słów każda) w języku polskim. " +
  "Pytanie jest jednokrotnego wyboru - użytkownik wybiera dokładnie jedną opcję albo wpisuje własną.\n" +
  "6. Po każdej odpowiedzi oceń swoją pewność (confidence, liczba 0-100) co do tego, czy masz już " +
  "wystarczająco konkretów od użytkownika, by napisać nieszablonowy, angażujący post. Kontynuuj pytania, " +
  "dopóki pewność nie osiągnie co najmniej 95, chyba że dostaniesz polecenie zakończenia wywiadu.\n" +
  "7. Gdy pewność osiągnie co najmniej 95 (albo dostaniesz polecenie zakończenia), zamiast kolejnego " +
  "pytania zwróć finalny post zbudowany na podstawie informacji zebranych od użytkownika: chwytliwy " +
  "tytuł, angażujący podpis (caption) i kilka trafnych hashtagów.\n\n" +
  "Pisz naturalnym językiem polskim. Nie używaj długich myślników (znak „—”) ani cudzysłowów w treści " +
  "pytań i posta.\n\n" +
  "Zawsze odpowiadaj WYŁĄCZNIE w formacie JSON, bez żadnego dodatkowego tekstu, w jednym z dwóch kształtów:\n\n" +
  'Gdy potrzebujesz więcej informacji:\n{"done": false, "confidence": number, "question": string, "options": string[]}\n\n' +
  'Gdy masz już wystarczająco informacji:\n{"done": true, "confidence": number, "title": string, "caption": string, "hashtags": string[]}';

router.post(
  "/interview",
  asyncHandler(async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "OpenAI API key nie jest skonfigurowany." });
      return;
    }

    const { topic, history } = interviewSchema.parse(req.body);

    const organization = await prisma.organization.findUnique({
      where: { id: req.user!.organizationId },
      select: { aiContext: true },
    });

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: INTERVIEW_SYSTEM_PROMPT }];
    if (organization?.aiContext?.trim()) {
      messages.push({ role: "system", content: `Kontekst o użytkowniku: ${organization.aiContext.trim()}` });
    }
    messages.push({ role: "user", content: `Temat posta: ${topic}` });
    for (const turn of history) {
      messages.push({
        role: "assistant",
        content: JSON.stringify({ done: false, question: turn.question, options: turn.options }),
      });
      messages.push({ role: "user", content: turn.answer });
    }
    if (history.length >= MAX_INTERVIEW_QUESTIONS) {
      messages.push({
        role: "system",
        content:
          "Osiągnięto limit pytań. Zakończ teraz wywiad: zwróć done:true wraz z najlepszym możliwym " +
          "postem, jaki da się napisać z dotychczasowych odpowiedzi, nawet jeśli pewność jest niższa niż 95.",
      });
    }

    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: {
      done?: boolean;
      confidence?: number;
      question?: string;
      options?: string[];
      title?: string;
      caption?: string;
      hashtags?: string[];
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;

    if (parsed.done) {
      res.json({
        done: true,
        confidence,
        title: parsed.title ?? "",
        caption: parsed.caption ?? "",
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
      });
      return;
    }

    res.json({
      done: false,
      confidence,
      question: parsed.question ?? "Czy możesz podać więcej szczegółów o poście, który chcesz stworzyć?",
      options: Array.isArray(parsed.options) ? parsed.options : [],
    });
  })
);

export default router;
