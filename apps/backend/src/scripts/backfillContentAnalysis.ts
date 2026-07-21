// One-off, manually-run backfill: (re)runs the full content-analysis
// pipeline (transcript/visual analysis, hook+hookDetail, cta+ctaDetail,
// topic, format - see lib/contentClassification.ts's
// analyzeAndClassifyInstagramPost) for already-scraped Instagram posts.
//
// Unlike the automatic daily job (classifyUnclassifiedInstagramPosts, gated
// by topic: null - only ever classifies a post once), this script ALWAYS
// re-runs classification for whatever --username/--limit you point it at,
// regardless of any existing topic/format/hook value - it's the explicit
// tool for upgrading specific historical posts to the new pipeline. Media
// analysis (transcript/visual) still skips per-field if already present.
//
// Usage: yarn workspace @mizaly/backend backfill:analysis --username <handle> --limit 20
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { analyzeAndClassifyInstagramPost } from "../lib/contentClassification";

const prisma = new PrismaClient();

function parseArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

async function main() {
  const usernameArg = parseArg("username");
  if (!usernameArg) {
    console.error("Usage: backfill:analysis --username <handle> [--limit 20]");
    process.exit(1);
  }
  const username = usernameArg.replace(/^@/, "");
  const limit = Number(parseArg("limit") ?? 20);

  const posts = await prisma.scrapedInstagramPost.findMany({
    where: { username },
    orderBy: { postedAt: "desc" },
    take: limit,
  });

  console.log(`Found ${posts.length} post(s) for @${username} (limit ${limit}).`);

  let done = 0;
  let failed = 0;

  for (const post of posts) {
    try {
      await analyzeAndClassifyInstagramPost(post);
      const updated = await prisma.scrapedInstagramPost.findUniqueOrThrow({ where: { id: post.id } });
      console.log(
        `[${post.id}] hook="${updated.hook}" (${updated.hookDetail?.slice(0, 60)}...) ` +
          `cta="${updated.cta}" (${updated.ctaDetail?.slice(0, 60)}...) topic="${updated.topic}" format="${updated.format}"`
      );
      done++;
    } catch (err) {
      console.error(`[${post.id}] Failed:`, err);
      failed++;
    }
  }

  console.log(`Backfill complete: processed ${done}, failed ${failed}.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
