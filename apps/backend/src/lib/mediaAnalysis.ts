// Real hook-source analysis for Instagram posts (see lib/contentClassification.ts's
// classifyHookFromSource): a "hook" is what a viewer actually sees/hears in the
// first instant of a Reel or image post - the spoken opening line, or whatever's
// shown/written on the cover image - NOT the caption (a separate thing read
// later). That real opening content doesn't exist as data yet, so this module
// builds it: a timestamped transcript for videos (OpenAI Whisper) and an AI
// description + literal on-image text for images (GPT-4o-mini vision). Both
// pull the already-R2-hosted media via lib/r2Store.ts - no new fetch/storage
// layer needed.
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { getMediaObject } from "./r2Store";

const execFileAsync = promisify(execFile);

function r2Filename(mediaUrl: string, postId: string): string {
  // saveMediaToR2 always names objects "{id}.{ext}" (see r2Store.ts) - simpler
  // and more robust to rebuild the filename from the known post id + the
  // stored URL's extension than to re-parse the full URL through
  // BACKEND_PUBLIC_URL/INSPIRATION_MEDIA_ROUTE.
  return `${postId}${path.extname(mediaUrl)}`;
}

async function fetchMediaBuffer(filename: string): Promise<Buffer> {
  const object = await getMediaObject(filename);
  const bytes = await object.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface VideoTranscript {
  text: string;
  segments: TranscriptSegment[];
}

export async function transcribeVideo(mediaUrl: string, postId: string): Promise<VideoTranscript | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[media-analysis] OPENAI_API_KEY missing - skipping transcription.");
    return null;
  }

  try {
    const buffer = await fetchMediaBuffer(r2Filename(mediaUrl, postId));
    const client = new OpenAI({ apiKey });
    const file = await toFile(buffer, r2Filename(mediaUrl, postId), { type: "video/mp4" });
    const response = await client.audio.transcriptions.create({
      model: "whisper-1",
      file,
      response_format: "verbose_json",
      language: "pl",
    });

    const segments = (response.segments ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
    }));
    return { text: response.text, segments };
  } catch (err) {
    console.error(`[media-analysis] Transcription failed for ${postId}:`, err);
    return null;
  }
}

const VISION_SYSTEM_PROMPT =
  `Opisujesz obraz z posta na Instagramie pod kątem tego, co widz zobaczyłby w pierwszej chwili. Odpowiadaj ` +
  `WYŁĄCZNIE PO POLSKU. Odpowiedz WYŁĄCZNIE czystym obiektem JSON {"description": "...", "extractedText": "..."} ` +
  `bez żadnego innego tekstu. "description" to krótki (1-2 zdania), napisany po polsku opis tego, co widać na ` +
  `obrazie. "extractedText" to DOSŁOWNY tekst zapisany/wyświetlony na obrazie (np. napis, cytat, tytuł slajdu) - ` +
  `pusty string, jeśli na obrazie nie ma żadnego tekstu (nie tłumacz go, przepisz dokładnie tak jak jest na obrazie).`;

export interface VisualAnalysis {
  description: string;
  extractedText: string;
}

const FALLBACK_VISUAL_ANALYSIS: VisualAnalysis = { description: "", extractedText: "" };

// Core vision call, decoupled from "fetch by R2 filename" so it can analyze
// either a post's actual image (analyzeImage) or a frame extracted from a
// video (analyzeVideoFrame) - same prompt/parsing either way.
async function analyzeImageBuffer(buffer: Buffer, mimeType: string, postId: string): Promise<VisualAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[media-analysis] OPENAI_API_KEY missing - skipping image analysis.");
    return null;
  }

  try {
    const dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;

    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: VISION_SYSTEM_PROMPT },
        { role: "user", content: [{ type: "image_url", image_url: { url: dataUri } }] },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return FALLBACK_VISUAL_ANALYSIS;

    try {
      const parsed = JSON.parse(raw);
      return {
        description: typeof parsed.description === "string" ? parsed.description : "",
        extractedText: typeof parsed.extractedText === "string" ? parsed.extractedText : "",
      };
    } catch {
      console.error(`[media-analysis] Model returned non-JSON output for ${postId}, using fallback.`);
      return FALLBACK_VISUAL_ANALYSIS;
    }
  } catch (err) {
    console.error(`[media-analysis] Image analysis failed for ${postId}:`, err);
    return null;
  }
}

function mimeTypeFromExtension(mediaUrl: string): string {
  const ext = path.extname(mediaUrl).replace(".", "") || "jpg";
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
}

export async function analyzeImage(mediaUrl: string, postId: string): Promise<VisualAnalysis | null> {
  const buffer = await fetchMediaBuffer(r2Filename(mediaUrl, postId));
  return analyzeImageBuffer(buffer, mimeTypeFromExtension(mediaUrl), postId);
}

// Extracts one representative frame from a video buffer via ffmpeg (already
// installed for Puppeteer/Chromium, see apps/backend/Dockerfile) - needs a
// real temp file since ffmpeg's seek (-ss) isn't reliable against a piped
// stream. Tries ~1s in first (avoids a black/transition frame at 0s), falls
// back to the very first frame once for very short Reels where 1s doesn't
// exist.
async function extractVideoFrame(videoBuffer: Buffer): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const id = crypto.randomUUID();
  const inPath = path.join(tmpDir, `${id}-in.mp4`);
  const outPath = path.join(tmpDir, `${id}-out.jpg`);

  try {
    await fs.writeFile(inPath, videoBuffer);

    async function tryExtract(seekSeconds: number): Promise<Buffer | null> {
      try {
        await execFileAsync("ffmpeg", ["-y", "-ss", String(seekSeconds), "-i", inPath, "-frames:v", "1", "-f", "image2", outPath]);
        return await fs.readFile(outPath);
      } catch {
        return null;
      }
    }

    return (await tryExtract(1)) ?? (await tryExtract(0)) ?? Promise.reject(new Error("ffmpeg produced no frame"));
  } finally {
    await fs.unlink(inPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});
  }
}

export async function analyzeVideoFrame(mediaUrl: string, postId: string): Promise<VisualAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[media-analysis] OPENAI_API_KEY missing - skipping frame analysis.");
    return null;
  }

  try {
    const videoBuffer = await fetchMediaBuffer(r2Filename(mediaUrl, postId));
    const frame = await extractVideoFrame(videoBuffer);
    return await analyzeImageBuffer(frame, "image/jpeg", postId);
  } catch (err) {
    console.error(`[media-analysis] Frame extraction/analysis failed for ${postId}:`, err);
    return null;
  }
}
