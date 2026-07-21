// Backend logic for "Przenoszenie treści z IG" (see ContentTransferSection.tsx):
// caches an organization's own last CONTENT_TRANSFER_POST_LIMIT Instagram
// posts (scraped via integrations/instagramScraper.ts, same scraper used for
// Inspiracje/Audyt twórcy - see the module comment there, it works against
// any public username, not just the watchlist) so the user can cross-post
// one of them to another connected platform via Zernio without Zernio ever
// being asked to "list posts I didn't publish through it" - it can't.
//
// The account to scrape is resolved from the org's connected Instagram
// SocialAccount by asking Zernio for that account's raw `username` field -
// SocialAccount.displayName isn't guaranteed to be the bare handle the
// scraper needs (see mapZernioAccount in integrations/zernio.ts).
import { prisma } from "./prisma";
import type { ContentTransferPost } from "@mizaly/shared";
import * as zernio from "../integrations/zernio";
import { resolveZernioApiKey } from "../integrations/zernioApiKeys";
import { ensureZernioProfileId } from "../integrations/zernioProfile";
import { isInstagramScraperConfigured, scrapeOneInstagramAccount } from "../integrations/instagramScraper";
import { uploadMedia } from "../integrations/cloudinary";
import { HttpError } from "./httpError";

// The stored imageUrl/videoUrl is handed straight to Zernio as a
// mediaItems[].url for IT to fetch server-side (routes/contentTransfer.ts),
// so it must be a URL Zernio's servers can actually reach - unlike
// Inspiracje's re-hosted media (lib/r2Store.ts, display-only, only ever
// fetched by the user's own browser), a URL on our own backend only works
// here if BACKEND_PUBLIC_URL is a real internet-facing address, which breaks
// on local dev (defaults to localhost). Cloudinary's URL is always a real
// public CDN link regardless of where this backend happens to be running, so
// re-hosting through it (like regular post photos, see routes/media.ts)
// avoids that whole class of problem instead of just working around it.
async function fetchAsDataUrl(remoteUrl: string, fallbackContentType: string): Promise<string> {
  const res = await fetch(remoteUrl);
  if (!res.ok) {
    throw new Error(`Nie udało się pobrać pliku (${res.status}): ${remoteUrl}`);
  }
  const contentType = res.headers.get("content-type") || fallbackContentType;
  const buffer = Buffer.from(await res.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

// User explicitly asked for only the last 10 - not a bigger cache trimmed
// down for display, an actual storage cap enforced after every refresh (see
// trimToLimit below).
export const CONTENT_TRANSFER_POST_LIMIT = 10;

function toApiShape(row: {
  id: string;
  organizationId: string;
  instagramPostId: string;
  url: string;
  caption: string;
  imageUrl: string | null;
  videoUrl: string | null;
  isReel: boolean;
  postedAt: Date | null;
  scrapedAt: Date;
  transferredTo: unknown;
}): ContentTransferPost {
  return {
    id: row.id,
    organizationId: row.organizationId,
    instagramPostId: row.instagramPostId,
    url: row.url,
    caption: row.caption,
    imageUrl: row.imageUrl,
    videoUrl: row.videoUrl,
    isReel: row.isReel,
    postedAt: row.postedAt ? row.postedAt.toISOString() : null,
    scrapedAt: row.scrapedAt.toISOString(),
    transferredTo: (row.transferredTo as Record<string, string> | null) ?? {},
  };
}

// Records that `id` was just cross-posted to `platform` right now - called
// right after a successful Zernio publish (routes/contentTransfer.ts). Merges
// into the existing JSON rather than overwriting it, so publishing to a
// second platform doesn't erase the first platform's recorded transfer.
// `platform` is a plain string, not the @mizaly/shared SocialPlatform enum -
// same reasoning as lib/enums.ts's SOCIAL_PLATFORM_VALUES/toZernioPlatformSlug.
export async function markContentTransferPostTransferred(
  id: string,
  organizationId: string,
  platform: string
): Promise<ContentTransferPost> {
  const existing = await prisma.contentTransferPost.findFirst({ where: { id, organizationId } });
  if (!existing) {
    throw new HttpError(404, "Nie znaleziono posta.");
  }
  const transferredTo = { ...((existing.transferredTo as Record<string, string> | null) ?? {}) };
  transferredTo[platform] = new Date().toISOString();
  const updated = await prisma.contentTransferPost.update({
    where: { id },
    data: { transferredTo },
  });
  return toApiShape(updated);
}

export async function getCachedContentTransferPosts(organizationId: string): Promise<ContentTransferPost[]> {
  const rows = await prisma.contentTransferPost.findMany({
    where: { organizationId },
    orderBy: [{ postedAt: "desc" }, { scrapedAt: "desc" }],
    take: CONTENT_TRANSFER_POST_LIMIT,
  });
  return rows.map(toApiShape);
}

// Resolves the zernioApiKeyId to act with for a background/organization-wide
// operation that has no `req.user` to read it from - picks any user in the
// organization, same fallback-to-key-"1" behavior as a real request would
// get via resolveZernioApiKey.
async function resolveOrgApiKey(organizationId: string): Promise<string> {
  const user = await prisma.user.findFirst({ where: { organizationId } });
  const apiKey = resolveZernioApiKey(user?.zernioApiKeyId);
  if (!apiKey) {
    throw new HttpError(503, "Zernio nie jest skonfigurowane dla tej organizacji.");
  }
  return apiKey;
}

async function resolveConnectedInstagramUsername(organizationId: string, apiKey: string): Promise<string> {
  const zernioProfileId = await ensureZernioProfileId(organizationId, apiKey);
  const remoteAccounts = await zernio.listAccounts(apiKey, zernioProfileId);
  const igAccount = remoteAccounts.find((a) => a.platform === "instagram");
  if (!igAccount) {
    throw new HttpError(400, "Brak podłączonego konta Instagram. Połącz je najpierw w zakładce Konta.");
  }
  const username = (igAccount.username as string | undefined) || (igAccount.name as string | undefined);
  if (!username) {
    throw new HttpError(502, "Zernio nie zwróciło nazwy użytkownika dla podłączonego konta Instagram.");
  }
  return username;
}

// Keeps only the CONTENT_TRANSFER_POST_LIMIT most recent rows for this org -
// run after every refresh so the cache never grows past what was asked for,
// rather than just displaying a truncated view of a bigger stored set.
async function trimToLimit(organizationId: string): Promise<void> {
  const keep = await prisma.contentTransferPost.findMany({
    where: { organizationId },
    orderBy: [{ postedAt: "desc" }, { scrapedAt: "desc" }],
    take: CONTENT_TRANSFER_POST_LIMIT,
    select: { id: true },
  });
  await prisma.contentTransferPost.deleteMany({
    where: { organizationId, id: { notIn: keep.map((row) => row.id) } },
  });
}

// One in-flight refresh per organization at a time - the manual "Odśwież"
// button and the background staleness job (see jobs/contentTransferScrapeJob.ts)
// could otherwise overlap and double-scrape the same account.
const inFlightRefreshes = new Map<string, Promise<ContentTransferPost[]>>();

export function isContentTransferRefreshRunning(organizationId: string): boolean {
  return inFlightRefreshes.has(organizationId);
}

export function refreshContentTransferPosts(organizationId: string): Promise<ContentTransferPost[]> {
  const existing = inFlightRefreshes.get(organizationId);
  if (existing) return existing;

  const run = (async () => {
    if (!isInstagramScraperConfigured()) {
      throw new HttpError(503, "Scraper Instagrama nie jest skonfigurowany (brak SCRAPE_DO_KEY).");
    }

    const apiKey = await resolveOrgApiKey(organizationId);
    const username = await resolveConnectedInstagramUsername(organizationId, apiKey);
    const posts = await scrapeOneInstagramAccount(username, CONTENT_TRANSFER_POST_LIMIT);

    for (const post of posts) {
      const existingRow = await prisma.contentTransferPost.findUnique({
        where: { organizationId_instagramPostId: { organizationId, instagramPostId: post.id } },
      });

      // A published post's media never changes - only re-host once per post,
      // same "don't redo expensive work for an already-known post" treatment
      // as jobs/inspirationScrapeJob.ts. Cloudinary folder is namespaced
      // per-org since two organizations could in principle have their
      // Instagram SocialAccount pointed at the same handle.
      let imageUrl = existingRow?.imageUrl ?? null;
      if (!existingRow && post.imageUrl) {
        try {
          const dataUrl = await fetchAsDataUrl(post.imageUrl, "image/jpeg");
          const uploaded = await uploadMedia(dataUrl, `mizaly/${organizationId}`);
          imageUrl = uploaded.url;
        } catch (err) {
          console.error(`[content-transfer] Failed to re-host image for post ${post.id}:`, err);
        }
      }

      let videoUrl = existingRow?.videoUrl ?? null;
      if (!existingRow && post.videoUrl) {
        try {
          const dataUrl = await fetchAsDataUrl(post.videoUrl, "video/mp4");
          const uploaded = await uploadMedia(dataUrl, `mizaly/${organizationId}`);
          videoUrl = uploaded.url;
        } catch (err) {
          console.error(`[content-transfer] Failed to re-host video for post ${post.id}:`, err);
        }
      }

      await prisma.contentTransferPost.upsert({
        where: { organizationId_instagramPostId: { organizationId, instagramPostId: post.id } },
        update: {
          url: post.url,
          caption: post.caption,
          imageUrl,
          videoUrl,
          isReel: post.isReel,
          postedAt: post.postedAt,
          scrapedAt: new Date(),
        },
        create: {
          organizationId,
          instagramPostId: post.id,
          url: post.url,
          caption: post.caption,
          imageUrl,
          videoUrl,
          isReel: post.isReel,
          postedAt: post.postedAt,
        },
      });
    }

    await trimToLimit(organizationId);
    return getCachedContentTransferPosts(organizationId);
  })();

  inFlightRefreshes.set(organizationId, run);
  run.finally(() => inFlightRefreshes.delete(organizationId));
  return run;
}
