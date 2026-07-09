// CRUD for the Instagram accounts watched by the scrape job (see
// src/jobs/inspirationScrapeJob.ts). Global list, not organization-scoped -
// same rationale as ScrapedInstagramPost.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.use(requireAuth);

const createSchema = z.object({
  username: z
    .string()
    .min(1)
    .transform((v) => v.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/$/, "")),
});

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const accounts = await prisma.watchedInstagramAccount.findMany({ orderBy: { createdAt: "asc" } });
    res.json(accounts);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { username } = createSchema.parse(req.body);
    if (!username) {
      throw new HttpError(400, "Podaj nazwę konta na Instagramie.");
    }

    const existing = await prisma.watchedInstagramAccount.findUnique({ where: { username } });
    if (existing) {
      throw new HttpError(409, "To konto jest już obserwowane.");
    }

    const account = await prisma.watchedInstagramAccount.create({ data: { username } });
    res.status(201).json(account);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.watchedInstagramAccount.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      throw new HttpError(404, "Nie znaleziono konta.");
    }
    await prisma.watchedInstagramAccount.delete({ where: { id: existing.id } });
    res.status(204).send();
  })
);

export default router;
