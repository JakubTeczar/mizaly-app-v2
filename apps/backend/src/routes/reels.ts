import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { requireAuth } from "../middleware/requireAuth";
import { CONTENT_STATUS_VALUES, SOCIAL_PLATFORM_VALUES } from "../lib/enums";

const router = Router();

router.use(requireAuth);

const createReelSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  videoUrl: z.string().min(1),
  platforms: z.array(z.enum(SOCIAL_PLATFORM_VALUES)).optional(),
  status: z.enum(CONTENT_STATUS_VALUES).optional(),
  scheduledAt: z.string().datetime().optional(),
});

const updateReelSchema = createReelSchema.partial();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const reels = await prisma.reel.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: "desc" },
    });
    res.json(reels);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const reel = await prisma.reel.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!reel) {
      throw new HttpError(404, "Nie znaleziono reelsa.");
    }
    res.json(reel);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createReelSchema.parse(req.body);

    const reel = await prisma.reel.create({
      data: {
        organizationId: req.user!.organizationId,
        title: data.title,
        description: data.description,
        videoUrl: data.videoUrl,
        platforms: data.platforms ?? [],
        status: data.status ?? "draft",
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
      },
    });

    res.status(201).json(reel);
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = updateReelSchema.parse(req.body);

    const existing = await prisma.reel.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!existing) {
      throw new HttpError(404, "Nie znaleziono reelsa.");
    }

    const reel = await prisma.reel.update({
      where: { id: existing.id },
      data: {
        title: data.title,
        description: data.description,
        videoUrl: data.videoUrl,
        platforms: data.platforms,
        status: data.status,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
      },
    });

    res.json(reel);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.reel.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!existing) {
      throw new HttpError(404, "Nie znaleziono reelsa.");
    }

    await prisma.reel.delete({ where: { id: existing.id } });

    res.status(204).send();
  })
);

export default router;
