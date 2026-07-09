import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.use(requireAuth);

// CRUD for the "tablica zapisanych inspiracji" (saved inspiration board).
const createItemSchema = z.object({
  sourceUrl: z.string().optional(),
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
  note: z.string().optional(),
});

const updateItemSchema = createItemSchema.partial();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const items = await prisma.inspirationItem.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: "desc" },
    });
    res.json(items);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const item = await prisma.inspirationItem.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!item) {
      throw new HttpError(404, "Nie znaleziono inspiracji.");
    }
    res.json(item);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createItemSchema.parse(req.body);

    const item = await prisma.inspirationItem.create({
      data: {
        organizationId: req.user!.organizationId,
        sourceUrl: data.sourceUrl,
        content: data.content,
        tags: data.tags ?? [],
        note: data.note,
      },
    });

    res.status(201).json(item);
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = updateItemSchema.parse(req.body);

    const existing = await prisma.inspirationItem.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!existing) {
      throw new HttpError(404, "Nie znaleziono inspiracji.");
    }

    const item = await prisma.inspirationItem.update({
      where: { id: existing.id },
      data,
    });

    res.json(item);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.inspirationItem.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!existing) {
      throw new HttpError(404, "Nie znaleziono inspiracji.");
    }

    await prisma.inspirationItem.delete({ where: { id: existing.id } });

    res.status(204).send();
  })
);

export default router;
