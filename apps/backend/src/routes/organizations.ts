import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { HttpError } from "../lib/httpError";

const router = Router();

router.use(requireAuth);

// Just the subset of Organization a regular (non-admin) user needs about
// their own org - currently only the carousel closing-slide template (see
// CarouselSlideEditor.tsx). Extend as more per-org settings need exposing.
router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const organization = await prisma.organization.findUnique({
      where: { id: req.user!.organizationId },
      select: {
        closingSlideTemplate: true,
      },
    });
    if (!organization) {
      throw new HttpError(404, "Nie znaleziono organizacji.");
    }
    res.json(organization);
  })
);

export default router;
