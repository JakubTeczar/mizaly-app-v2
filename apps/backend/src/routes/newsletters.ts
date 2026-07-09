// Read-only list/detail for newsletters pulled from the shared mailbox (see
// src/jobs/newsletterFetchJob.ts). No management endpoints - it's a single
// fixed inbox, not a per-source watch list.

import { Router } from "express";
import sanitizeHtml from "sanitize-html";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const newsletters = await prisma.newsletterEmail.findMany({
      orderBy: { receivedAt: "desc" },
      select: { id: true, subject: true, fromName: true, fromAddress: true, receivedAt: true },
    });
    res.json(newsletters);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const newsletter = await prisma.newsletterEmail.findUnique({ where: { id: req.params.id } });
    if (!newsletter) {
      throw new HttpError(404, "Nie znaleziono newslettera.");
    }

    const bodyHtml = newsletter.bodyHtml
      ? sanitizeHtml(newsletter.bodyHtml, {
          // No <style> tag: sanitize-html flags it as inherently XSS-vulnerable
          // (CSS-based exfiltration via attribute selectors, expression()).
          // Inline style="" attributes below cover the formatting most
          // newsletter templates actually need.
          allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "font", "center", "h1", "h2", "h3"],
          allowedAttributes: {
            "*": ["style", "align", "width", "height", "class", "colspan", "rowspan", "valign", "bgcolor"],
            a: ["href", "name", "target"],
            img: ["src", "alt", "width", "height"],
          },
          allowedSchemes: ["http", "https", "mailto"],
        })
      : null;

    res.json({ ...newsletter, bodyHtml });
  })
);

export default router;
