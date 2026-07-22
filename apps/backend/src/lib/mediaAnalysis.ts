// Real hook-source analysis for Instagram posts (see lib/contentClassification.ts's
// classifyHookFromSource): a "hook" is what a viewer actually sees/hears in the
// first instant of a Reel or image post - the spoken opening line, or whatever's
// shown/written on the cover image - NOT the caption (a separate thing read
// later). That real opening content doesn't exist as data yet, so this module
// builds it: a timestamped transcript for videos (OpenAI Whisper) and an AI
// description + literal on-image text for images (GPT-4o-mini vision). Both
// pull the already-R2-hosted media via lib/r2Store.ts - no new fetch/storage
// layer needed. For Reels/videos, the visual hook is judged from actual frames
// pulled out of the video file itself (via ffmpeg), never Instagram's own
// cover/thumbnail image - that cover is a separate, hand-picked preview and can
// look nothing like what the video actually opens on.
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { getMediaObject } from "./r2Store";
import { withOpenAiRetry } from "./openaiRetry";

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

// Whisper is a known to hallucinate this exact credit line (and close
// variants) on silent/near-silent audio - it was trained on a large corpus
// of Amara.org-subtitled videos and reproduces the subtitle credit as if it
// were spoken when there's nothing real to transcribe (see e.g.
// github.com/openai/whisper/discussions/928). Segments matching this are
// dropped rather than trusted as real content; if that empties the
// transcript entirely, treat it the same as "no transcript".
const WHISPER_HALLUCINATION_PATTERN = /amara\.org/i;

function stripWhisperHallucinations(text: string, segments: TranscriptSegment[]): VideoTranscript | null {
  const cleanSegments = segments.filter((s) => !WHISPER_HALLUCINATION_PATTERN.test(s.text));
  if (cleanSegments.length === 0) {
    return WHISPER_HALLUCINATION_PATTERN.test(text) ? null : { text, segments };
  }
  if (cleanSegments.length === segments.length) return { text, segments };
  return { text: cleanSegments.map((s) => s.text).join(" ").trim(), segments: cleanSegments };
}

// Whisper hard-caps uploads at 25MB (26214400 bytes, per its own 413 error
// message) - a Reel's raw MP4 buffer occasionally exceeds this (long/high-
// bitrate video). Rather than give up with no transcript at all (client
// feedback: a partial transcript beats none), extract just the audio track -
// a Reel's video stream is the vast majority of its size, so compressed
// audio-only is tiny by comparison and fixes virtually every real case on
// its own. A bit under the hard cap so the output file's own container
// overhead doesn't push it back over the real limit.
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;
const AUDIO_EXTRACT_TARGET_BYTES = 24 * 1024 * 1024;

// If the extracted audio is STILL over the target (a genuinely very long
// recording), ffmpeg's own `-fs` flag truncates the OUTPUT at that byte
// count during encoding rather than failing - producing a valid (if
// partial, cut off at the end) audio file instead of nothing.
async function extractCompressedAudio(videoBuffer: Buffer): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const id = crypto.randomUUID();
  const inPath = path.join(tmpDir, `${id}-in.mp4`);
  const outPath = path.join(tmpDir, `${id}-out.mp3`);
  try {
    await fs.writeFile(inPath, videoBuffer);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", inPath,
      "-vn",
      "-acodec", "libmp3lame",
      "-b:a", "64k",
      "-fs", String(AUDIO_EXTRACT_TARGET_BYTES),
      outPath,
    ]);
    return await fs.readFile(outPath);
  } finally {
    await fs.unlink(inPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});
  }
}

export async function transcribeVideo(mediaUrl: string, postId: string): Promise<VideoTranscript | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[media-analysis] OPENAI_API_KEY missing - skipping transcription.");
    return null;
  }

  try {
    let buffer = await fetchMediaBuffer(r2Filename(mediaUrl, postId));
    let filename = r2Filename(mediaUrl, postId);
    let mimeType = "video/mp4";

    if (buffer.length > WHISPER_MAX_BYTES) {
      console.warn(
        `[media-analysis] ${postId} video is ${buffer.length} bytes (over Whisper's ${WHISPER_MAX_BYTES}-byte ` +
          `cap) - extracting compressed audio instead of sending the full video.`
      );
      buffer = await extractCompressedAudio(buffer);
      filename = `${postId}.mp3`;
      mimeType = "audio/mpeg";
    }

    const client = new OpenAI({ apiKey });
    const file = await toFile(buffer, filename, { type: mimeType });
    const response = await withOpenAiRetry(() => client.audio.transcriptions.create({
      model: "whisper-1",
      file,
      response_format: "verbose_json",
      language: "pl",
    }));

    const segments = (response.segments ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
    }));
    return stripWhisperHallucinations(response.text, segments);
  } catch (err) {
    console.error(`[media-analysis] Transcription failed for ${postId}:`, err);
    return null;
  }
}

// The 7 signal categories a still/frame can meaningfully carry, per the
// "hooking period" creative-diagnostics framework (on-screen text, face
// presence, product presence, motion intensity, cuts, brand assets, sound
// events - see docs/Backlog.md) - everything except sound events, which
// needs actual audio analysis, not a frame description (transcribeVideo's
// Whisper transcript is the closest thing we have to an audio signal, kept
// separate rather than faked here).
// facePresence and shotType are deliberately separate questions - "is a
// human face visible at all" vs "how tight is the framing" are independent
// (a wide gym shot can still have a technically-recognizable face; a close-up
// can be on a product/hand with no face at all). Standard cinematography
// shot-type vocabulary, not a vague "close/far" guess.
export const SHOT_TYPE_VALUES = ["zbliżenie", "plan średni", "plan pełny"] as const;
export const MOTION_INTENSITY_VALUES = ["niska", "średnia", "wysoka"] as const;
export type ShotType = (typeof SHOT_TYPE_VALUES)[number];
export type MotionIntensity = (typeof MOTION_INTENSITY_VALUES)[number];

const VISION_SYSTEM_PROMPT =
  `Opisujesz obraz z posta na Instagramie pod kątem tego, co widz zobaczyłby w pierwszej chwili. Odpowiadaj ` +
  `WYŁĄCZNIE PO POLSKU. Odpowiedz WYŁĄCZNIE czystym obiektem JSON {"description": "...", "extractedText": "...", ` +
  `"facePresence": true/false, "shotType": "...", "productPresence": true/false, "motionIntensity": "...", ` +
  `"brandAssets": true/false} bez żadnego innego tekstu. "description" to krótki (1-2 zdania) opis tego, co ` +
  `widać na obrazie. "extractedText" to DOSŁOWNY tekst zapisany/wyświetlony na obrazie (np. napis, cytat, tytuł ` +
  `slajdu) - pusty string, jeśli na obrazie nie ma żadnego tekstu (nie tłumacz go, przepisz dokładnie tak jak ` +
  `jest na obrazie). "facePresence" - czy w kadrze w ogóle widać ludzką twarz (obojętnie z jakiej odległości). ` +
  `"shotType" to JEDNA z: "${SHOT_TYPE_VALUES.join('", "')}" - "zbliżenie" gdy twarz/głowa wypełnia większość ` +
  `kadru, "plan średni" gdy widać od pasa/klatki piersiowej w górę, "plan pełny" gdy widać całą sylwetkę/postać ` +
  `(np. całe ćwiczenie na siłowni) - to pytanie o kadrowanie, NIEZALEŻNE od tego czy twarz jest widoczna. ` +
  `"productPresence" - czy w kadrze widać wyraźnie produkt/sprzęt/miejsce jako główny element. "motionIntensity" ` +
  `to JEDNA z: "${MOTION_INTENSITY_VALUES.join('", "')}" - czy samo zdjęcie sugeruje ruch/akcję (np. w trakcie ` +
  `ćwiczenia) czy jest statyczne. "brandAssets" - czy widoczne jest logo, oznaczenie marki/sponsoringu.`;

export interface VisualAnalysis {
  description: string;
  extractedText: string;
  facePresence: boolean;
  shotType: ShotType;
  productPresence: boolean;
  motionIntensity: MotionIntensity;
  brandAssets: boolean;
}

const FALLBACK_VISUAL_ANALYSIS: VisualAnalysis = {
  description: "",
  extractedText: "",
  facePresence: false,
  shotType: "plan pełny",
  productPresence: false,
  motionIntensity: "niska",
  brandAssets: false,
};

function parseVisualAnalysis(parsed: any): VisualAnalysis {
  return {
    description: typeof parsed.description === "string" ? parsed.description : "",
    extractedText: typeof parsed.extractedText === "string" ? parsed.extractedText : "",
    facePresence: Boolean(parsed.facePresence),
    shotType: SHOT_TYPE_VALUES.includes(parsed.shotType) ? parsed.shotType : "plan pełny",
    productPresence: Boolean(parsed.productPresence),
    motionIntensity: MOTION_INTENSITY_VALUES.includes(parsed.motionIntensity) ? parsed.motionIntensity : "niska",
    brandAssets: Boolean(parsed.brandAssets),
  };
}

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
    const completion = await withOpenAiRetry(() => client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: VISION_SYSTEM_PROMPT },
        { role: "user", content: [{ type: "image_url", image_url: { url: dataUri } }] },
      ],
    }));

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return FALLBACK_VISUAL_ANALYSIS;

    try {
      return parseVisualAnalysis(JSON.parse(raw));
    } catch {
      console.error(`[media-analysis] Model returned non-JSON output for ${postId}, using fallback.`);
      return FALLBACK_VISUAL_ANALYSIS;
    }
  } catch (err) {
    console.error(`[media-analysis] Image analysis failed for ${postId}:`, err);
    return null;
  }
}

// Same idea as VISION_SYSTEM_PROMPT, but for several frames sampled across the
// opening of a video (see VIDEO_HOOK_FRAME_SECONDS below) instead of one
// still image - asks for a single combined description of that opening beat,
// not one description per frame.
const VISION_MULTI_FRAME_SYSTEM_PROMPT =
  `Otrzymujesz kilka klatek wyciętych z samego początku Reelsa/wideo na Instagramie, w kolejności czasowej ` +
  `(pierwsza klatka to sam początek nagrania, kolejne to kolejne sekundy). Opisujesz, co widz zobaczyłby w tym ` +
  `otwierającym momencie, traktując wszystkie klatki razem jako jeden krótki fragment (np. ruch, zmianę kadru ` +
  `czy pojawiający się napis między klatkami), a NIE jako osobne obrazy. Odpowiadaj WYŁĄCZNIE PO POLSKU. ` +
  `Odpowiedz WYŁĄCZNIE czystym obiektem JSON {"description": "...", "extractedText": "...", "facePresence": ` +
  `true/false, "shotType": "...", "productPresence": true/false, "motionIntensity": "...", "brandAssets": ` +
  `true/false} bez żadnego innego tekstu. "description" to krótki (1-2 zdania) opis tego, co dzieje się w tym ` +
  `otwierającym momencie. "extractedText" to DOSŁOWNY tekst zapisany/wyświetlony na którejkolwiek z klatek (np. ` +
  `napis, cytat) - pusty string, jeśli na żadnej klatce nie ma tekstu (nie tłumacz, przepisz dokładnie tak jak ` +
  `jest na klatce). "facePresence" - czy w którejkolwiek klatce w ogóle widać ludzką twarz (obojętnie z jakiej ` +
  `odległości). "shotType" to JEDNA z: "${SHOT_TYPE_VALUES.join('", "')}" - "zbliżenie" gdy twarz/głowa wypełnia ` +
  `większość kadru, "plan średni" gdy widać od pasa/klatki piersiowej w górę, "plan pełny" gdy widać całą ` +
  `sylwetkę/postać (np. całe ćwiczenie na siłowni) - to pytanie o kadrowanie, NIEZALEŻNE od tego czy twarz jest ` +
  `widoczna. "productPresence" - czy w którejkolwiek klatce widać wyraźnie produkt/sprzęt/miejsce jako główny ` +
  `element. "motionIntensity" to JEDNA z: "${MOTION_INTENSITY_VALUES.join('", "')}" - jak bardzo kadr zmienia ` +
  `się między klatkami (ruch kamery, ruch osoby/przedmiotu). "brandAssets" - czy widoczne jest logo, oznaczenie ` +
  `marki/sponsoringu.`;

// Multi-image sibling of analyzeImageBuffer - sends all frames in one vision
// call so the model judges them as one opening moment instead of several
// independent stills that would then need to be stitched together after the
// fact.
async function analyzeImageBuffers(buffers: Buffer[], mimeType: string, postId: string): Promise<VisualAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[media-analysis] OPENAI_API_KEY missing - skipping image analysis.");
    return null;
  }

  try {
    const client = new OpenAI({ apiKey });
    const completion = await withOpenAiRetry(() => client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: VISION_MULTI_FRAME_SYSTEM_PROMPT },
        {
          role: "user",
          content: buffers.map((buffer) => ({
            type: "image_url" as const,
            image_url: { url: `data:${mimeType};base64,${buffer.toString("base64")}` },
          })),
        },
      ],
    }));

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return FALLBACK_VISUAL_ANALYSIS;

    try {
      return parseVisualAnalysis(JSON.parse(raw));
    } catch {
      console.error(`[media-analysis] Model returned non-JSON output for ${postId}, using fallback.`);
      return FALLBACK_VISUAL_ANALYSIS;
    }
  } catch (err) {
    console.error(`[media-analysis] Multi-frame image analysis failed for ${postId}:`, err);
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

// Sampled at 0.5s/1.5s/2.75s rather than exactly 0/1/2s - avoids landing
// exactly on a black/transition frame at the very start (the old single-frame
// code needed a separate 1s->0s fallback for this same reason) and spreads
// slightly wider across the ~3s "hooking period" that's the critical window
// for retention (see docs/Backlog.md). Instagram's own cover image (a
// separate, hand-picked preview) is never used here at all.
const VIDEO_HOOK_FRAME_SECONDS = [0.5, 1.5, 2.75];

// Extracts frames at VIDEO_HOOK_FRAME_SECONDS from a video buffer via ffmpeg
// (already installed for Puppeteer/Chromium, see apps/backend/Dockerfile) -
// needs a real temp file since ffmpeg's seek (-ss) isn't reliable against a
// piped stream. Very short Reels may not have a frame at every requested
// second - those seeks are skipped, keeping whichever frames succeeded.
async function extractVideoFrames(videoBuffer: Buffer): Promise<Buffer[]> {
  const tmpDir = os.tmpdir();
  const id = crypto.randomUUID();
  const inPath = path.join(tmpDir, `${id}-in.mp4`);

  try {
    await fs.writeFile(inPath, videoBuffer);

    async function tryExtract(seekSeconds: number): Promise<Buffer | null> {
      const outPath = path.join(tmpDir, `${id}-out-${seekSeconds}.jpg`);
      try {
        await execFileAsync("ffmpeg", ["-y", "-ss", String(seekSeconds), "-i", inPath, "-frames:v", "1", "-f", "image2", outPath]);
        return await fs.readFile(outPath);
      } catch {
        return null;
      } finally {
        await fs.unlink(outPath).catch(() => {});
      }
    }

    const frames = await Promise.all(VIDEO_HOOK_FRAME_SECONDS.map(tryExtract));
    const successful = frames.filter((frame): frame is Buffer => frame !== null);
    if (successful.length === 0) throw new Error("ffmpeg produced no frame");
    return successful;
  } finally {
    await fs.unlink(inPath).catch(() => {});
  }
}

export async function analyzeVideoFrames(mediaUrl: string, postId: string): Promise<VisualAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[media-analysis] OPENAI_API_KEY missing - skipping frame analysis.");
    return null;
  }

  try {
    const videoBuffer = await fetchMediaBuffer(r2Filename(mediaUrl, postId));
    const frames = await extractVideoFrames(videoBuffer);
    return await analyzeImageBuffers(frames, "image/jpeg", postId);
  } catch (err) {
    console.error(`[media-analysis] Frame extraction/analysis failed for ${postId}:`, err);
    return null;
  }
}
