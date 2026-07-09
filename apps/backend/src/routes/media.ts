import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { HttpError } from "../lib/httpError";
import { isCloudinaryConfigured, uploadMedia } from "../integrations/cloudinary";

const router = Router();

const uploadSchema = z.object({
  dataUrl: z.string().min(1),
});

router.post(
  "/upload",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isCloudinaryConfigured()) {
      throw new HttpError(503, "Cloudinary nie jest skonfigurowane.");
    }

    const { dataUrl } = uploadSchema.parse(req.body);
    if (!dataUrl.startsWith("data:")) {
      throw new HttpError(400, "Oczekiwano pliku w formacie data URL.");
    }

    const result = await uploadMedia(dataUrl, `mizaly/${req.user!.organizationId}`);
    res.status(201).json(result);
  })
);

export default router;
