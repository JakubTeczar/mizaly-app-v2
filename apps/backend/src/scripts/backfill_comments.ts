import "dotenv/config";
import { fetchAndStoreComments } from "../lib/creatorAudit";
import { prisma } from "../lib/prisma";

async function main() {
  const posts = await prisma.creatorAuditPost.findMany({
    where: { username: "trener_z_polnocy" },
    select: { id: true, url: true, instagramPostId: true },
  });
  console.log(`Fetching comments for ${posts.length} post(s).`);
  let done = 0;
  let failed = 0;
  for (const post of posts) {
    try {
      await fetchAndStoreComments({ id: post.id, url: post.url });
      const count = await prisma.creatorAuditComment.count({ where: { postId: post.id } });
      console.log(`${post.instagramPostId}: ${count} comment(s)`);
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
