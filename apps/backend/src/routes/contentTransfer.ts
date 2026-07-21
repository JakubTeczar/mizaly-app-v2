// "Przenoszenie treści z IG" - lets a user browse their own last cached
// Instagram posts and cross-post one to another connected platform via
// Zernio. See lib/contentTransfer.ts for the scrape/cache logic and
// jobs/contentTransferScrapeJob.ts for the background refresh.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { requireAuth } from "../middleware/requireAuth";
import { SOCIAL_PLATFORM_VALUES } from "../lib/enums";
import * as zernio from "../integrations/zernio";
import { ensureZernioProfileId } from "../integrations/zernioProfile";
import { resolveZernioApiKey } from "../integrations/zernioApiKeys";
import {
  getCachedContentTransferPosts,
  isContentTransferRefreshRunning,
  markContentTransferPostTransferred,
  refreshContentTransferPosts,
} from "../lib/contentTransfer";

const router = Router();

router.use(requireAuth);

// So a user mashing the "Odśwież" button (or the background job overlapping
// a manual click) can't rack up Scrape.do requests - one manual refresh per
// organization per REFRESH_COOLDOWN_MS, tracked in-memory (best-effort, fine
// to reset on a redeploy).
const REFRESH_COOLDOWN_MS = 2 * 60 * 1000;
const lastManualRefreshAt = new Map<string, number>();

router.get(
  "/posts",
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId;
    const instagramAccount = await prisma.socialAccount.findFirst({
      where: { organizationId, platform: "instagram" },
    });

    if (!instagramAccount) {
      return res.json({ connected: false, posts: [], isRefreshing: false });
    }

    const posts = await getCachedContentTransferPosts(organizationId);
    res.json({ connected: true, posts, isRefreshing: isContentTransferRefreshRunning(organizationId) });
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId;
    const lastAt = lastManualRefreshAt.get(organizationId);
    if (lastAt && Date.now() - lastAt < REFRESH_COOLDOWN_MS && !isContentTransferRefreshRunning(organizationId)) {
      throw new HttpError(429, "Poczekaj chwilę przed kolejnym odświeżeniem.");
    }

    lastManualRefreshAt.set(organizationId, Date.now());
    const posts = await refreshContentTransferPosts(organizationId);
    res.json({ posts });
  })
);

const publishSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORM_VALUES),
  content: z.string(),
});

router.post(
  "/:id/publish",
  asyncHandler(async (req, res) => {
    const { platform, content } = publishSchema.parse(req.body);
    const organizationId = req.user!.organizationId;

    const post = await prisma.contentTransferPost.findFirst({ where: { id: req.params.id, organizationId } });
    if (!post) {
      throw new HttpError(404, "Nie znaleziono posta.");
    }

    const account = await prisma.socialAccount.findFirst({ where: { organizationId, platform } });
    if (!account) {
      throw new HttpError(400, `Brak połączonego konta dla: ${platform}. Połącz je najpierw w zakładce Konta.`);
    }

    const apiKey = resolveZernioApiKey(req.user!.zernioApiKeyId);
    if (!apiKey) {
      throw new HttpError(503, "Zernio nie jest skonfigurowane dla tego użytkownika.");
    }

    const mediaItems = post.videoUrl
      ? [{ type: "video" as const, url: post.videoUrl }]
      : post.imageUrl
        ? [{ type: "image" as const, url: post.imageUrl }]
        : [];
    if (mediaItems.length === 0) {
      throw new HttpError(400, "Ten post nie ma zapisanego medium do przesłania.");
    }

    const zernioProfileId = await ensureZernioProfileId(organizationId, apiKey);
    const result = await zernio.createZernioPost(apiKey, {
      profileId: zernioProfileId,
      content,
      platforms: [{ platform: zernio.toZernioPlatformSlug(platform), accountId: account.zernioAccountId }],
      mediaItems,
      publishNow: true,
    });

    const updatedPost = await markContentTransferPostTransferred(post.id, organizationId, platform);

    res.json({ result, post: updatedPost });
  })
);

export default router;
