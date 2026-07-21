import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { requireAdminAuth } from "../middleware/requireAdminAuth";
import { hasAnyConfiguredZernioApiKey, listConfiguredZernioApiKeys } from "../integrations/zernioApiKeys";
import { isCloudinaryConfigured, uploadMedia } from "../integrations/cloudinary";
import { carouselSlideSchema } from "../lib/carouselSlideSchema";
import { Prisma } from "@prisma/client";

const router = Router();

router.use(requireAdminAuth);

const createUserSchema = z.object({
  organizationName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  zernioApiKeyId: z.string().min(1).nullable().optional(),
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(["owner", "member"]).optional(),
  zernioApiKeyId: z.string().min(1).nullable().optional(),
});

const updateOrganizationSchema = z.object({
  aiContext: z.string().max(4000).nullable().optional(),
  closingSlideTemplate: carouselSlideSchema.nullable().optional(),
});

const uploadClosingSlideImageSchema = z.object({
  dataUrl: z.string().min(1),
});

function toPublicUser(user: {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  createdAt: Date;
  zernioApiKeyId: string | null;
}) {
  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    zernioApiKeyId: user.zernioApiKeyId,
  };
}

// Zernio itself allows unlimited connected accounts per API key, but only the
// first 2 are free - each additional one is paid. This client has paid for
// one extra slot, so the self-imposed ceiling here is 3 (2 free + 1 paid),
// not Zernio's own hard limit - it exists purely so nobody accidentally
// connects a 4th account and racks up an unexpected charge. Called before
// both create and update so the limit can't be bypassed either way.
const ZERNIO_ACCOUNTS_PER_KEY_LIMIT = 3;

async function assertZernioApiKeySlotAvailable(zernioApiKeyId: string, excludeUserId?: string): Promise<void> {
  const count = await prisma.user.count({
    where: {
      zernioApiKeyId,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
  });
  if (count >= ZERNIO_ACCOUNTS_PER_KEY_LIMIT) {
    throw new HttpError(
      409,
      `Do tego klucza Zernio API są już przypisani ${ZERNIO_ACCOUNTS_PER_KEY_LIMIT} użytkownicy (ustawiony limit, 2 darmowe + 1 płatne).`
    );
  }
}

// Admin-initiated tenant provisioning (docs/ROADMAP.md "Dodawanie userów (MVP)").
// Self-service signup also exists via POST /api/auth/register.
router.post(
  "/users",
  asyncHandler(async (req, res) => {
    const { organizationName, email, password, zernioApiKeyId } = createUserSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new HttpError(409, "Użytkownik z tym adresem e-mail już istnieje.");
    }

    if (zernioApiKeyId) {
      await assertZernioApiKeySlotAvailable(zernioApiKeyId);
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const organization = await prisma.organization.create({
      data: { name: organizationName },
    });

    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        email,
        passwordHash,
        role: "owner",
        zernioApiKeyId: zernioApiKeyId ?? null,
      },
    });

    res.status(201).json({
      organization,
      user: toPublicUser(user),
    });
  })
);

router.patch(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const data = updateUserSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      throw new HttpError(404, "Nie znaleziono użytkownika.");
    }

    if (data.email && data.email !== existing.email) {
      const emailTaken = await prisma.user.findUnique({ where: { email: data.email } });
      if (emailTaken) {
        throw new HttpError(409, "Użytkownik z tym adresem e-mail już istnieje.");
      }
    }

    if (data.zernioApiKeyId && data.zernioApiKeyId !== existing.zernioApiKeyId) {
      await assertZernioApiKeySlotAvailable(data.zernioApiKeyId, existing.id);
    }

    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        email: data.email,
        role: data.role,
        // Only overwrite when the key is explicitly present in the body
        // (including explicit null to unassign) - omitting the field
        // entirely must leave the existing assignment untouched.
        ...("zernioApiKeyId" in req.body ? { zernioApiKeyId: data.zernioApiKeyId ?? null } : {}),
      },
    });

    res.json(toPublicUser(user));
  })
);

router.get(
  "/organizations",
  asyncHandler(async (_req, res) => {
    const organizations = await prisma.organization.findMany({
      include: {
        users: {
          select: {
            id: true,
            organizationId: true,
            email: true,
            role: true,
            createdAt: true,
            zernioApiKeyId: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(organizations);
  })
);

router.patch(
  "/organizations/:id",
  asyncHandler(async (req, res) => {
    const data = updateOrganizationSchema.parse(req.body);

    const existing = await prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      throw new HttpError(404, "Nie znaleziono organizacji.");
    }

    const organization = await prisma.organization.update({
      where: { id: existing.id },
      // Only overwrite when explicitly present in the body (including
      // explicit null to clear it) - an omitted field must leave the
      // existing value untouched.
      data: {
        ...("aiContext" in req.body ? { aiContext: data.aiContext ?? null } : {}),
        ...("closingSlideTemplate" in req.body
          ? { closingSlideTemplate: data.closingSlideTemplate ?? Prisma.DbNull }
          : {}),
      },
    });

    res.json(organization);
  })
);

// Uploads an image (background or an inset image layer) for this
// organization's carousel closing-slide template - used by admin's
// ClosingSlideEditor.tsx as the `onUploadImage` callback for the shared
// canvas editor (packages/shared/src/carousel/SlideCanvasEditor.tsx), same
// role as /api/media/upload plays for a regular user. Returns just the url,
// not the organization, since the caller decides itself whether that url
// becomes the background or a new image layer.
router.post(
  "/organizations/:id/closing-slide-image",
  asyncHandler(async (req, res) => {
    if (!isCloudinaryConfigured()) {
      throw new HttpError(503, "Cloudinary nie jest skonfigurowane.");
    }

    const { dataUrl } = uploadClosingSlideImageSchema.parse(req.body);
    if (!dataUrl.startsWith("data:")) {
      throw new HttpError(400, "Oczekiwano pliku w formacie data URL.");
    }

    const existing = await prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      throw new HttpError(404, "Nie znaleziono organizacji.");
    }

    const result = await uploadMedia(dataUrl, `mizaly/${existing.id}`, { format: "jpg" });
    res.status(201).json({ url: result.url });
  })
);

router.get(
  "/zernio-api-keys",
  asyncHandler(async (_req, res) => {
    res.json({ keys: listConfiguredZernioApiKeys() });
  })
);

router.get(
  "/system/status",
  asyncHandler(async (_req, res) => {
    res.json({
      zernioConfigured: hasAnyConfiguredZernioApiKey(),
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    });
  })
);

export default router;
