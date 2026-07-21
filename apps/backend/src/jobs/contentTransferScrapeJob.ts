// Background job: keeps each organization's cached "own last 10 Instagram
// posts" (lib/contentTransfer.ts, backing ContentTransferSection.tsx) fresh
// without scraping on every page view. Staleness-based rather than a fixed
// cron expression, same pattern as jobs/inspirationScrapeJob.ts: on boot (and
// then hourly) check each org's newest scrapedAt and only re-scrape it if
// older than STALE_MS. Survives server restarts/redeploys without an
// external cron service and without double-running (see
// isContentTransferRefreshRunning in lib/contentTransfer.ts).
import { prisma } from "../lib/prisma";
import { refreshContentTransferPosts } from "../lib/contentTransfer";

const STALE_MS = 5 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;

async function refreshStaleOrganizations(): Promise<void> {
  const accounts = await prisma.socialAccount.findMany({
    where: { platform: "instagram" },
    select: { organizationId: true },
    distinct: ["organizationId"],
  });

  for (const { organizationId } of accounts) {
    const newest = await prisma.contentTransferPost.findFirst({
      where: { organizationId },
      orderBy: { scrapedAt: "desc" },
      select: { scrapedAt: true },
    });
    if (newest && Date.now() - newest.scrapedAt.getTime() <= STALE_MS) {
      continue;
    }

    try {
      await refreshContentTransferPosts(organizationId);
    } catch (err) {
      console.error(`[content-transfer-job] Refresh failed for organization ${organizationId}:`, err);
    }
  }
}

export function startContentTransferScrapeScheduler(): void {
  setTimeout(() => {
    refreshStaleOrganizations().catch((err) => console.error("[content-transfer-job] Initial check failed:", err));
  }, 10_000);

  setInterval(() => {
    refreshStaleOrganizations().catch((err) => console.error("[content-transfer-job] Periodic check failed:", err));
  }, CHECK_EVERY_MS);
}
