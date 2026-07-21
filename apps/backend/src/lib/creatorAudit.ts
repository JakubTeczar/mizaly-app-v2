// Per-organization audit of ONE creator's OWN Instagram posting history - the
// admin panel's "Audyt tworcy" tab (routes/adminCreatorAudit.ts). See
// CreatorAuditAccount/CreatorAuditPost in schema.prisma for why this is a
// fully separate table/pipeline from ScrapedInstagramPost/
// WatchedInstagramAccount (those are a GLOBAL watchlist of OTHER accounts
// shared by every organization for cross-account trend-spotting inspiration -
// mixing a client's own account in there would leak their content into every
// other organization's shared Inspiracje trends feed).
//
// Reuses the exact same scraper (integrations/instagramScraper.ts) and
// per-signal classification helpers (lib/mediaAnalysis.ts, lib/
// contentClassification.ts) as that global pipeline - only the persistence
// target (CreatorAuditPost, not ScrapedInstagramPost) and the post count
// (caller-supplied, not the fixed POSTS_PER_ACCOUNT) differ.
//
// Two client-driven differences from the legacy global pipeline (dialed in
// against real example posts - see docs/Backlog.md):
// - A video/Reel post never gets a cover image at all (imageUrls stays
//   empty) - the real opening is the extracted video frames, not
//   Instagram's own hand-picked cover.
// - An image/carousel post gets EVERY slide analyzed separately (not just
//   the cover), so a CTA that only appears on e.g. the last slide is still
//   found - see slideAnalysis on CreatorAuditPost.
import type { CreatorAuditSlideAnalysis } from "@mizaly/shared";
import { prisma } from "./prisma";
import {
  isInstagramScraperConfigured,
  scrapeOneInstagramAccount,
  fetchPostComments,
  type ScrapedPost,
} from "../integrations/instagramScraper";
import { saveMediaToR2 } from "./r2Store";
import { transcribeVideo, analyzeImage, analyzeVideoFrames, type VideoTranscript } from "./mediaAnalysis";
import {
  classifyVideoHook,
  classifyPostHook,
  classifyCtaWithLocation,
  classifyTopicFormat,
  hookSourceFromTranscript,
} from "./contentClassification";

const BACKEND_PUBLIC_URL = (process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`).replace(
  /\/$/,
  ""
);

export interface CreatorAuditFetchResult {
  fetched: number;
  newPosts: number;
}

// Re-hosts every one of a post's images (Instagram's CDN links are
// short-lived/hotlink-blocked, same reason jobs/inspirationScrapeJob.ts does
// this) under a distinct per-slide R2 key, then vision-analyzes each slide
// SEPARATELY (not combined into one call) - a carousel's slides are usually
// thematically distinct frames (unlike a video's 3 near-identical opening
// frames, which genuinely benefit from being judged together), so each one
// gets its own description/extractedText entry in slideAnalysis.
async function rehostAndAnalyzeImages(instagramPostId: string, imageUrls: string[]): Promise<{
  hostedUrls: string[];
  slideAnalysis: CreatorAuditSlideAnalysis[];
}> {
  const hostedUrls: string[] = [];
  const slideAnalysis: CreatorAuditSlideAnalysis[] = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const rawUrl = imageUrls[i];
    const slideKey = `${instagramPostId}-slide${i}`;
    let hostedUrl = rawUrl;
    try {
      const path = await saveMediaToR2(rawUrl, slideKey, "jpg");
      hostedUrl = `${BACKEND_PUBLIC_URL}${path}`;
    } catch (err) {
      console.error(`[creator-audit] Failed to re-host slide ${i} for post ${instagramPostId}:`, err);
    }
    hostedUrls.push(hostedUrl);

    const analysis = await analyzeImage(hostedUrl, slideKey);
    if (analysis) {
      slideAnalysis.push({ source: `slajd ${i + 1}/${imageUrls.length}`, ...analysis });
    }
  }

  return { hostedUrls, slideAnalysis };
}

// Runs the full classification pipeline (transcript/visual analysis,
// hookText/hookVisual/cta/topic/format) for one already-created row, then
// writes everything in one final update.
export async function analyzeCreatorAuditPost(post: {
  id: string;
  instagramPostId: string;
  caption: string;
  imageUrls: string[];
  videoUrl: string | null;
}): Promise<void> {
  let imageUrls = post.imageUrls;
  let videoUrl = post.videoUrl;
  let transcript: VideoTranscript | null = null;
  let slideAnalysis: CreatorAuditSlideAnalysis[] = [];

  if (post.videoUrl) {
    // Narrowed local (not the outer `videoUrl`, which TS still sees as
    // string|null even inside this block since it's a separate reassignable
    // binding) - falls back to the raw url if the R2 re-host attempt fails.
    let hostedVideoUrl: string = post.videoUrl;
    try {
      const path = await saveMediaToR2(post.videoUrl, post.instagramPostId, "mp4");
      hostedVideoUrl = `${BACKEND_PUBLIC_URL}${path}`;
    } catch (err) {
      console.error(`[creator-audit] Failed to re-host video for post ${post.instagramPostId}:`, err);
    }
    videoUrl = hostedVideoUrl;

    transcript = await transcribeVideo(hostedVideoUrl, post.instagramPostId);
    const frames = await analyzeVideoFrames(hostedVideoUrl, post.instagramPostId);
    if (frames) {
      slideAnalysis = [{ source: "klatki 0.5s/1.5s/2.75s", ...frames }];
    }
  } else if (post.imageUrls.length > 0) {
    const result = await rehostAndAnalyzeImages(post.instagramPostId, post.imageUrls);
    imageUrls = result.hostedUrls;
    slideAnalysis = result.slideAnalysis;
  }

  // Hook = the FIRST moment only (first slide / the video's opening frames),
  // judged as ONE combined thing per medium (not two separate text/visual
  // axes - see classifyVideoHook/classifyPostHook). CTA/topic/format instead
  // look at EVERY slide combined, since a CTA can sit on any slide (often
  // the last one), not just the opening.
  const firstSlide = slideAnalysis[0];
  let hookVideo: string | null = null;
  let hookVideoDetail: string | null = null;
  let hookPost: string | null = null;
  let hookPostDetail: string | null = null;

  if (videoUrl) {
    const transcriptWindow = transcript ? hookSourceFromTranscript(transcript.segments, transcript.text) : "";
    const result = await classifyVideoHook(firstSlide?.description ?? "", transcriptWindow);
    hookVideo = result.hookVideo;
    hookVideoDetail = result.hookVideoDetail;
  } else if (firstSlide) {
    const result = await classifyPostHook(firstSlide.description, firstSlide.extractedText);
    hookPost = result.hookPost;
    hookPostDetail = result.hookPostDetail;
  }

  const allSlideText = slideAnalysis.flatMap((s) => [s.description, s.extractedText]).filter(Boolean).join("\n\n");
  const mainContent = [transcript?.text, allSlideText].filter(Boolean).join("\n\n");
  const { cta, ctaDetail, ctaLocation } = await classifyCtaWithLocation(post.caption, mainContent);

  const allSignals = [post.caption, mainContent].filter(Boolean).join("\n\n");
  const combinedInput = [allSignals, ctaDetail].filter(Boolean).join("\n\n");
  const { topic, format, formatDetail } = await classifyTopicFormat(combinedInput);

  await prisma.creatorAuditPost.update({
    where: { id: post.id },
    data: {
      imageUrls,
      videoUrl,
      transcript: transcript as any,
      slideAnalysis: slideAnalysis.length > 0 ? (slideAnalysis as any) : undefined,
      hookVideo,
      hookVideoDetail,
      hookPost,
      hookPostDetail,
      cta,
      ctaDetail,
      ctaLocation,
      topic,
      format,
      formatDetail,
    },
  });
}

// Always fetched for every new CreatorAuditPost (unlike the legacy global
// pipeline's opt-in INSTAGRAM_FETCH_COMMENTS) - the whole point of an audit
// is having the full picture for one specific client's account, and this is
// a small enough scale that the extra Scrape.do request per post is worth
// it. Exported so scripts/backfillCreatorAuditComments-style one-off runs
// can call it directly for posts fetched before this existed.
export async function fetchAndStoreComments(post: { id: string; url: string; mediaId?: string | null }): Promise<void> {
  const comments = await fetchPostComments(post.url, post.mediaId);
  if (comments.length === 0) return;

  await prisma.creatorAuditComment.createMany({
    data: comments.map((c) => ({
      id: c.id,
      postId: post.id,
      author: c.owner,
      authorId: c.ownerId,
      authorVerified: c.ownerVerified,
      text: c.text,
      likeCount: c.likes,
      postedAt: c.createdAt ? new Date(c.createdAt * 1000) : null,
    })),
    skipDuplicates: true,
  });
}

// Re-runs the full analysis pipeline (transcript/vision + hook/cta/topic/
// format classification) on every post ALREADY stored for this organization,
// without hitting the scraper again - for when a prompt/taxonomy change (see
// lib/contentClassification.ts) should be reflected on already-fetched posts
// instead of only newly-fetched ones. Re-transcribes/re-analyzes media from
// scratch for every post (analyzeCreatorAuditPost doesn't skip-if-present),
// so this re-runs the full OpenAI cost per post, not just the classification
// calls - fine at this feature's current scale (tens, not thousands, of
// posts per organization).
export async function reanalyzeCreatorAuditPosts(organizationId: string): Promise<{ reanalyzed: number }> {
  const posts = await prisma.creatorAuditPost.findMany({ where: { organizationId } });

  for (const post of posts) {
    try {
      await analyzeCreatorAuditPost({
        id: post.id,
        instagramPostId: post.instagramPostId,
        caption: post.caption,
        imageUrls: post.imageUrls,
        videoUrl: post.videoUrl,
      });
    } catch (err) {
      console.error(`[creator-audit] Re-analysis failed for post ${post.instagramPostId}:`, err);
    }
  }

  return { reanalyzed: posts.length };
}

// Fetches up to `postsCount` of `username`'s most recent posts and runs the
// full analysis pipeline on whichever ones aren't already stored for this
// organization - a later call with a bigger postsCount (10 -> 50 -> 200) only
// processes the newly-revealed posts, never re-touches ones already audited
// (matched on the same (organizationId, username, postedAt) a post the
// global pipeline uses, see CreatorAuditPost's @@unique).
export async function fetchAndAnalyzeCreatorAudit(
  organizationId: string,
  username: string,
  postsCount: number
): Promise<CreatorAuditFetchResult> {
  if (!isInstagramScraperConfigured()) {
    throw new Error("Scraper Instagrama (Scrape.do) nie jest skonfigurowany.");
  }

  await prisma.creatorAuditAccount.upsert({
    where: { organizationId },
    update: { username },
    create: { organizationId, username },
  });

  const posts: ScrapedPost[] = await scrapeOneInstagramAccount(username, postsCount);
  const scrapedAt = new Date();
  let newPosts = 0;

  for (const post of posts) {
    // Postgres treats every NULL as distinct, so the unique constraint can't
    // dedupe a null postedAt - skip rather than risk piling up duplicate rows
    // for the rare malformed post on every re-fetch.
    if (!post.postedAt) continue;

    const existing = await prisma.creatorAuditPost.findUnique({
      where: { organizationId_username_postedAt: { organizationId, username: post.username, postedAt: post.postedAt } },
    });
    if (existing) continue;

    newPosts++;
    const created = await prisma.creatorAuditPost.create({
      data: {
        organizationId,
        username: post.username,
        instagramPostId: post.id,
        url: post.url,
        type: post.type,
        caption: post.caption,
        imageUrls: post.imageUrls,
        videoUrl: post.videoUrl,
        isReel: post.isReel,
        likesCount: post.likesCount,
        commentsCount: post.commentsCount,
        videoViewCount: post.videoViewCount,
        postedAt: post.postedAt,
        scrapedAt,
      },
    });

    try {
      await analyzeCreatorAuditPost({
        id: created.id,
        instagramPostId: post.id,
        caption: post.caption,
        imageUrls: post.imageUrls,
        videoUrl: post.videoUrl,
      });
    } catch (err) {
      console.error(`[creator-audit] Analysis failed for post ${post.id}:`, err);
    }

    try {
      await fetchAndStoreComments({ id: created.id, url: post.url, mediaId: post.mediaId });
    } catch (err) {
      console.error(`[creator-audit] Comment fetch failed for post ${post.id}:`, err);
    }
  }

  await prisma.creatorAuditAccount.update({ where: { organizationId }, data: { lastScrapedAt: scrapedAt } });

  return { fetched: posts.length, newPosts };
}
