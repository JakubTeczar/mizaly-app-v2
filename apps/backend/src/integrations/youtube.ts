// YouTube scraping via yt-dlp (wrapped by the yt-dlp-exec npm package, which
// downloads a static per-platform binary at install time - no system Python
// dependency, works the same on a Railway build as it does locally). This is
// an unofficial method (no API key, no ToS-compliant quota) - see the
// discussion with the user: chosen over the YouTube Data API because that API
// cannot return another channel's caption track (OAuth-owner-only), so we'd
// need yt-dlp for transcripts either way.
//
// Called ONLY by the every-2-days background job in
// src/jobs/youtubeScrapeJob.ts, which persists results to ScrapedYoutubeVideo
// / ScrapedYoutubeComment - API routes read from the DB, never from here.

import youtubedl from "yt-dlp-exec";

export interface YoutubeVideoSummary {
  id: string;
  title: string;
}

export interface YoutubeComment {
  id: string;
  author: string;
  text: string;
  likeCount: number;
  postedAt: Date | null;
}

export interface YoutubeVideoDetails {
  id: string;
  title: string;
  thumbnailUrl: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  durationSec: number | null;
  publishedAt: Date | null;
  transcript: string | null;
  comments: YoutubeComment[];
}

const COMMENTS_TO_FETCH = 50;

export async function listRecentVideos(handle: string, limit = 3): Promise<YoutubeVideoSummary[]> {
  const info: any = await youtubedl(`https://www.youtube.com/@${handle}/videos`, {
    flatPlaylist: true,
    playlistEnd: limit,
    dumpSingleJson: true,
    noWarnings: true,
  });
  const entries = Array.isArray(info?.entries) ? info.entries : [];
  return entries
    .filter((e: any) => e?.id)
    .map((e: any) => ({ id: String(e.id), title: String(e.title ?? "") }));
}

// Used by the "add channel" endpoint to validate the handle and show a
// friendly display name immediately instead of waiting for the next scrape.
export async function resolveChannelDisplayName(handle: string): Promise<string | null> {
  const info: any = await youtubedl(`https://www.youtube.com/@${handle}/videos`, {
    flatPlaylist: true,
    playlistEnd: 1,
    dumpSingleJson: true,
    noWarnings: true,
  });
  return info?.channel ?? info?.uploader ?? null;
}

function extractTranscript(info: any): Promise<string | null> {
  const tracks: any[] | undefined =
    info?.subtitles?.pl ?? info?.subtitles?.en ?? info?.automatic_captions?.pl ?? info?.automatic_captions?.en;
  const json3Track = tracks?.find((t) => t.ext === "json3");
  if (!json3Track?.url) return Promise.resolve(null);

  return fetch(json3Track.url)
    .then((res) => (res.ok ? res.json() : null))
    .then((data: any) => {
      if (!data?.events) return null;
      const text = data.events
        .flatMap((e: any) => e.segs ?? [])
        .map((s: any) => s.utf8 ?? "")
        .join("")
        .replace(/\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return text || null;
    })
    .catch(() => null);
}

export async function fetchVideoDetails(videoId: string): Promise<YoutubeVideoDetails> {
  // writeComments/extractorArgs are real yt-dlp CLI flags but missing from
  // yt-dlp-exec's (incomplete, hand-maintained) TS definitions - cast past it.
  const info: any = await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
    skipDownload: true,
    dumpSingleJson: true,
    noWarnings: true,
    writeComments: true,
    extractorArgs: `youtube:comment_sort=top;max_comments=${COMMENTS_TO_FETCH},${COMMENTS_TO_FETCH},${COMMENTS_TO_FETCH},10`,
  } as any);

  const transcript = await extractTranscript(info);

  const comments: YoutubeComment[] = Array.isArray(info?.comments)
    ? info.comments.map((c: any) => ({
        id: String(c.id),
        author: String(c.author ?? ""),
        text: String(c.text ?? ""),
        likeCount: Number(c.like_count ?? 0),
        postedAt: c.timestamp ? new Date(c.timestamp * 1000) : null,
      }))
    : [];

  return {
    id: videoId,
    title: String(info?.title ?? ""),
    thumbnailUrl: String(info?.thumbnail ?? ""),
    viewCount: Number(info?.view_count ?? 0),
    likeCount: Number(info?.like_count ?? 0),
    commentCount: Number(info?.comment_count ?? comments.length),
    durationSec: typeof info?.duration === "number" ? info.duration : null,
    publishedAt: info?.upload_date
      ? new Date(`${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`)
      : null,
    transcript,
    comments,
  };
}
