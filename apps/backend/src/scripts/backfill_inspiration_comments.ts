// One-off: INSTAGRAM_FETCH_COMMENTS was never enabled, so every
// ScrapedInstagramPost already scraped by the Inspiracje watchlist job has 0
// comments. Backfills comments for all of them WITHOUT touching
// images/video/transcript/classification - only re-scrapes each watched
// account's current FEED (not individual posts) to resolve `mediaId` for
// Reels (fetchPostComments's internal media_id resolution only works for
// image/carousel posts - see integrations/instagramScraper.ts), then fetches
// comments per already-known post. Safe to re-run - skips any post that
// already has comments.
import "dotenv/config";
import { scrapeOneInstagramAccount, fetchPostComments } from "../integrations/instagramScraper";
import { prisma } from "../lib/prisma";

// Generous vs. the job's own POSTS_PER_ACCOUNT (25) - a backfill should try
// to resolve mediaId for as much of each account's already-scraped history
// as possible, not just its most recent posts.
const RESCAN_POSTS_PER_ACCOUNT = 300;

async function main() {
  const watched = await prisma.watchedInstagramAccount.findMany();
  console.log(`Re-scraping feeds for ${watched.length} watched account(s) to resolve mediaId for Reels...`);

  const mediaIdByPostId = new Map<string, string | null>();
  for (const { username } of watched) {
    try {
      const posts = await scrapeOneInstagramAccount(username, RESCAN_POSTS_PER_ACCOUNT);
      for (const post of posts) mediaIdByPostId.set(post.id, post.mediaId);
    } catch (err) {
      console.error(`Failed to re-scrape feed for @${username}:`, err instanceof Error ? err.message : err);
    }
  }

  const dbPosts = await prisma.scrapedInstagramPost.findMany({ select: { id: true, url: true, isReel: true } });
  console.log(`Fetching comments for ${dbPosts.length} already-scraped post(s) - no re-fetch of media/images.`);

  let done = 0;
  let failed = 0;
  let totalComments = 0;
  for (const post of dbPosts) {
    const existingCount = await prisma.scrapedInstagramComment.count({ where: { postId: post.id } });
    if (existingCount > 0) {
      done++;
      continue;
    }

    try {
      const mediaId = mediaIdByPostId.get(post.id) ?? null;
      const comments = await fetchPostComments(post.url, mediaId);
      if (comments.length > 0) {
        await prisma.scrapedInstagramComment.createMany({
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
      const mediaIdNote = post.isReel && !mediaId ? " (Reel, no mediaId resolved - may be incomplete)" : "";
      console.log(`${post.id}: ${comments.length} comment(s)${mediaIdNote}`);
      totalComments += comments.length;
      done++;
    } catch (err) {
      console.error(`${post.id}: FAILED`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  console.log(`Done: ${done} succeeded, ${failed} failed, ${totalComments} comment(s) fetched in total.`);
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error("FAILED", e);
  await prisma.$disconnect();
  process.exit(1);
});
