import "dotenv/config";
import { scrapeOneInstagramAccount } from "../integrations/instagramScraper";
import { fetchAndStoreComments } from "../lib/creatorAudit";
import { prisma } from "../lib/prisma";

async function main() {
  const dbPosts = await prisma.creatorAuditPost.findMany({
    where: { username: "trener_z_polnocy", isReel: true },
    select: { id: true, url: true, instagramPostId: true },
  });
  console.log(`Re-scraping feed to resolve mediaId for ${dbPosts.length} Reel(s)...`);
  const freshPosts = await scrapeOneInstagramAccount("trener_z_polnocy", 50);
  const mediaIdByShortcode = new Map(freshPosts.map((p) => [p.id, p.mediaId]));

  let done = 0;
  let failed = 0;
  for (const post of dbPosts) {
    const mediaId = mediaIdByShortcode.get(post.instagramPostId);
    try {
      await fetchAndStoreComments({ id: post.id, url: post.url, mediaId });
      const count = await prisma.creatorAuditComment.count({ where: { postId: post.id } });
      console.log(`${post.instagramPostId}: mediaId=${mediaId} -> ${count} comment(s)`);
      done++;
    } catch (err) {
      console.error(`${post.instagramPostId}: FAILED`, err instanceof Error ? err.message : err);
      failed++;
    }
  }
  console.log(`Done: ${done} succeeded, ${failed} failed.`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FAILED", e); await prisma.$disconnect(); process.exit(1); });
