// CRUD for the YouTube channels watched by the scrape job (see
// src/jobs/youtubeScrapeJob.ts). Global list, not organization-scoped - same
// rationale as WatchedInstagramAccount.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { requireAuth } from "../middleware/requireAuth";
import { resolveChannelDisplayName } from "../integrations/youtube";

const router = Router();

router.use(requireAuth);

const createSchema = z.object({
  handle: z
    .string()
    .min(1)
    .transform((v) =>
      v
        .trim()
        .replace(/^https?:\/\/(www\.)?youtube\.com\//i, "")
        .replace(/^@/, "")
        .replace(/\/.*$/, "")
    ),
});

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const channels = await prisma.watchedYoutubeChannel.findMany({ orderBy: { createdAt: "asc" } });
    res.json(channels);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { handle } = createSchema.parse(req.body);
    if (!handle) {
      throw new HttpError(400, "Podaj identyfikator kanału (np. @NazwaKanalu).");
    }

    const existing = await prisma.watchedYoutubeChannel.findUnique({ where: { handle } });
    if (existing) {
      throw new HttpError(409, "Ten kanał jest już obserwowany.");
    }

    let displayName: string | null;
    try {
      displayName = await resolveChannelDisplayName(handle);
    } catch {
      displayName = null;
    }
    if (!displayName) {
      throw new HttpError(400, "Nie znaleziono kanału o podanym identyfikatorze.");
    }

    const channel = await prisma.watchedYoutubeChannel.create({ data: { handle, displayName } });
    res.status(201).json(channel);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.watchedYoutubeChannel.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      throw new HttpError(404, "Nie znaleziono kanału.");
    }
    await prisma.watchedYoutubeChannel.delete({ where: { id: existing.id } });
    res.status(204).send();
  })
);

export default router;
