import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { requireAuth } from "../middleware/requireAuth";
import { CONTENT_STATUS_VALUES } from "../lib/enums";

const router = Router();

router.use(requireAuth);

// Two creation paths: from an existing Post (derive title/body from it - a
// stub for future AI-assisted generation, per ROADMAP.md section 3), or
// from scratch with an explicit title/body.
const fromSourcePostSchema = z.object({
  sourcePostId: z.string().min(1),
  status: z.enum(CONTENT_STATUS_VALUES).optional(),
});

const fromScratchSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  status: z.enum(CONTENT_STATUS_VALUES).optional(),
});

const updateArticleSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  status: z.enum(CONTENT_STATUS_VALUES).optional(),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const articles = await prisma.websiteArticle.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: "desc" },
    });
    res.json(articles);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const article = await prisma.websiteArticle.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!article) {
      throw new HttpError(404, "Nie znaleziono artykułu.");
    }
    res.json(article);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId;

    if (req.body && typeof req.body.sourcePostId === "string") {
      const { sourcePostId, status } = fromSourcePostSchema.parse(req.body);

      const sourcePost = await prisma.post.findFirst({
        where: { id: sourcePostId, organizationId },
      });
      if (!sourcePost) {
        throw new HttpError(404, "Nie znaleziono posta źródłowego.");
      }

      // Naive stub: reuse the post's heading/content as-is. Future milestone:
      // AI-assisted rewrite into proper article form.
      const article = await prisma.websiteArticle.create({
        data: {
          organizationId,
          title: sourcePost.heading,
          body: sourcePost.content,
          sourcePostId: sourcePost.id,
          status: status ?? "draft",
        },
      });

      res.status(201).json(article);
      return;
    }

    const { title, body, status } = fromScratchSchema.parse(req.body);

    const article = await prisma.websiteArticle.create({
      data: {
        organizationId,
        title,
        body,
        status: status ?? "draft",
      },
    });

    res.status(201).json(article);
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = updateArticleSchema.parse(req.body);

    const existing = await prisma.websiteArticle.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!existing) {
      throw new HttpError(404, "Nie znaleziono artykułu.");
    }

    const article = await prisma.websiteArticle.update({
      where: { id: existing.id },
      data,
    });

    res.json(article);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.websiteArticle.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!existing) {
      throw new HttpError(404, "Nie znaleziono artykułu.");
    }

    await prisma.websiteArticle.delete({ where: { id: existing.id } });

    res.status(204).send();
  })
);

export default router;
