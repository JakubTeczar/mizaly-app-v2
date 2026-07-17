import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { requireAuth } from "../middleware/requireAuth";
import { CONTENT_STATUS_VALUES, SOCIAL_PLATFORM_VALUES } from "../lib/enums";
import * as zernio from "../integrations/zernio";
import { ensureZernioProfileId } from "../integrations/zernioProfile";
import { resolveZernioApiKey } from "../integrations/zernioApiKeys";
import { uploadMedia } from "../integrations/cloudinary";
import { buildStoryHtml } from "../media/storyTemplate";
import { renderHtmlToJpeg } from "../media/render";

const router = Router();

router.use(requireAuth);

// Carousel slides are rendered client-side (react-konva) - the backend just
// stores the layout JSON (for re-editing) alongside the exported image URLs
// that actually get published, see mediaUrls above.
const carouselTextLayerSchema = z.object({
  id: z.string(),
  content: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  fontSize: z.number(),
  fontFamily: z.string(),
  color: z.string(),
  align: z.enum(["left", "center", "right"]),
});

const carouselSlideSchema = z.object({
  order: z.number(),
  backgroundImageUrl: z.string().optional(),
  backgroundImageX: z.number().optional(),
  backgroundImageY: z.number().optional(),
  backgroundImageScale: z.number().optional(),
  textLayers: z.array(carouselTextLayerSchema).default([]),
});

const createPostSchema = z.object({
  heading: z.string().min(1),
  content: z.string().min(1),
  firstComment: z.string().optional(),
  mediaUrls: z.array(z.string()).optional(),
  carouselSlides: z.array(carouselSlideSchema).optional(),
  platforms: z.array(z.enum(SOCIAL_PLATFORM_VALUES)).optional(),
  status: z.enum(CONTENT_STATUS_VALUES).optional(),
  scheduledAt: z.string().datetime().optional(),
});

const updatePostSchema = createPostSchema.partial();

// Hardcoded until Organization has its own name/subtitle profile fields for
// the story header - using the raw organization.name (e.g. "Demo
// Organization") looked wrong in practice, so this stands in for now.
const STORY_HEADER_NAME = "Łukasz Biegun";
const STORY_HEADER_SUBTITLE = "Trener personalny";

interface StoryRenderParams {
  photoUrl: string;
  heading: string;
  content: string;
  // Small badge above the title - "NOWY POST" by default (see
  // storyTemplate.ts), overridden for the "series" template with the
  // user-provided series name so it renders in that same spot.
  label?: string;
}

async function renderStoryJpegBuffer(params: StoryRenderParams): Promise<Buffer> {
  const html = buildStoryHtml({
    photoUrl: params.photoUrl,
    name: STORY_HEADER_NAME,
    subtitle: STORY_HEADER_SUBTITLE,
    label: params.label,
    title: params.heading || params.content.slice(0, 60),
    description: params.heading ? params.content : undefined,
  });
  return renderHtmlToJpeg(html);
}

// Renders the post's photo through the branded story template (see
// media/storyTemplate.ts) and uploads the result, for use as a nicer
// Instagram Story than just the raw feed photo. Best-effort: any failure
// here must fall back to the raw photo, never break the story publish.
async function renderStoryImageUrl(params: StoryRenderParams): Promise<string | null> {
  try {
    const buffer = await renderStoryJpegBuffer(params);
    const dataUrl = `data:image/jpeg;base64,${buffer.toString("base64")}`;
    const uploaded = await uploadMedia(dataUrl, "stories");
    return uploaded.url;
  } catch (err) {
    console.error("Story template render failed, falling back to raw photo:", err);
    return null;
  }
}

function dayRange(dateString: string): { start: Date; end: Date } {
  const start = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new HttpError(400, "Nieprawidłowy format daty, oczekiwano YYYY-MM-DD.");
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { date } = req.query;

    const where: Record<string, unknown> = { organizationId: req.user!.organizationId };

    if (typeof date === "string") {
      const { start, end } = dayRange(date);
      where.OR = [
        { scheduledAt: { gte: start, lt: end } },
        { publishedAt: { gte: start, lt: end } },
      ];
    }

    const posts = await prisma.post.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    res.json(posts);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const post = await prisma.post.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!post) {
      throw new HttpError(404, "Nie znaleziono posta.");
    }
    res.json(post);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createPostSchema.parse(req.body);

    const post = await prisma.post.create({
      data: {
        organizationId: req.user!.organizationId,
        heading: data.heading,
        content: data.content,
        firstComment: data.firstComment,
        mediaUrls: data.mediaUrls ?? [],
        carouselSlides: data.carouselSlides,
        platforms: data.platforms ?? [],
        status: data.status ?? "draft",
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
      },
    });

    res.status(201).json(post);
  })
);

const storyPreviewSchema = z.object({
  photoUrl: z.string().min(1),
  heading: z.string().optional(),
  content: z.string().optional(),
  storyTemplate: z.enum(["new_post", "series"]).optional(),
  seriesName: z.string().optional(),
});

// On-demand render of the branded story template for the post composer's
// template preview - doesn't touch the database or Cloudinary, just returns
// the rendered image straight back as a data URL. Only called when a
// template other than "Brak" is selected; the raw-photo case needs no render.
router.post(
  "/story-preview",
  asyncHandler(async (req, res) => {
    const data = storyPreviewSchema.parse(req.body);

    const buffer = await renderStoryJpegBuffer({
      photoUrl: data.photoUrl,
      heading: data.heading || "",
      content: data.content || "",
      label: data.storyTemplate === "series" ? data.seriesName?.trim() || "SERIA" : undefined,
    });

    res.json({ dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}` });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = updatePostSchema.parse(req.body);

    const existing = await prisma.post.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!existing) {
      throw new HttpError(404, "Nie znaleziono posta.");
    }

    const post = await prisma.post.update({
      where: { id: existing.id },
      data: {
        heading: data.heading,
        content: data.content,
        firstComment: data.firstComment,
        mediaUrls: data.mediaUrls,
        carouselSlides: data.carouselSlides,
        platforms: data.platforms,
        status: data.status,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
      },
    });

    res.json(post);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.post.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!existing) {
      throw new HttpError(404, "Nie znaleziono posta.");
    }

    await prisma.post.delete({ where: { id: existing.id } });

    res.status(204).send();
  })
);

const publishSchema = z.object({
  mode: z.enum(["now", "schedule"]),
  scheduledFor: z.string().datetime().optional(),
  // Ephemeral, per-publish choice - never persisted on the Post itself (see
  // PostSection.tsx). "none" (or omitted) means the auto Instagram Story
  // below is just the raw post photo, no branded template.
  storyTemplate: z.enum(["none", "new_post", "series"]).optional(),
  seriesName: z.string().optional(),
});

// Sends an already-saved post to Zernio for real - either right away
// (publishNow) or at a future time (scheduledFor). Requires a connected
// SocialAccount for every platform on the post; the Zernio profile is
// created lazily on first use (see integrations/zernioProfile.ts).
router.post(
  "/:id/publish",
  asyncHandler(async (req, res) => {
    const { mode, scheduledFor, storyTemplate, seriesName } = publishSchema.parse(req.body);
    if (mode === "schedule" && !scheduledFor) {
      throw new HttpError(400, "Podaj datę i godzinę planowanej publikacji.");
    }

    const organizationId = req.user!.organizationId;
    const post = await prisma.post.findFirst({ where: { id: req.params.id, organizationId } });
    if (!post) {
      throw new HttpError(404, "Nie znaleziono posta.");
    }
    if (post.platforms.length === 0) {
      throw new HttpError(400, "Wybierz co najmniej jedną platformę przed publikacją.");
    }
    const apiKey = resolveZernioApiKey(req.user!.zernioApiKeyId);
    if (!apiKey) {
      throw new HttpError(503, "Zernio nie jest skonfigurowane dla tego użytkownika.");
    }

    const accounts = await prisma.socialAccount.findMany({
      where: { organizationId, platform: { in: post.platforms } },
    });
    const accountByPlatform = new Map(accounts.map((account) => [account.platform, account]));
    const missingPlatforms = post.platforms.filter((platform) => !accountByPlatform.has(platform));
    if (missingPlatforms.length > 0) {
      throw new HttpError(
        400,
        `Brak połączonego konta dla: ${missingPlatforms.join(", ")}. Połącz je najpierw w zakładce Konta.`
      );
    }

    const zernioProfileId = await ensureZernioProfileId(organizationId, apiKey);
    const platformsPayload = post.platforms.map((platform) => {
      const zernioSlug = zernio.toZernioPlatformSlug(platform);
      const supportsFirstComment = (zernio.FIRST_COMMENT_SUPPORTED_PLATFORMS as readonly string[]).includes(zernioSlug);
      return {
        platform: zernioSlug,
        accountId: accountByPlatform.get(platform)!.zernioAccountId,
        ...(post.firstComment && supportsFirstComment
          ? { platformSpecificData: { firstComment: post.firstComment } }
          : {}),
      };
    });
    const mediaItems = post.mediaUrls.map((url) => ({ type: "image" as const, url }));
    // Instagram etc. have no dedicated "heading" field - fold it into the
    // visible caption so it isn't silently lost; also sent as `title` for
    // the platforms that do use it (YouTube/Pinterest/TikTok).
    const content = [post.heading, post.content].filter(Boolean).join("\n\n");

    try {
      const result = await zernio.createZernioPost(apiKey, {
        profileId: zernioProfileId,
        content,
        title: post.heading || undefined,
        platforms: platformsPayload,
        mediaItems: mediaItems.length > 0 ? mediaItems : undefined,
        publishNow: mode === "now" ? true : undefined,
        scheduledFor: mode === "schedule" ? scheduledFor : undefined,
      });

      const updated = await prisma.post.update({
        where: { id: post.id },
        data: {
          status: mode === "now" ? "published" : "scheduled",
          zernioPostId: result.id || null,
          publishError: null,
          publishedAt: mode === "now" ? new Date() : post.publishedAt,
          scheduledAt: mode === "schedule" ? new Date(scheduledFor!) : post.scheduledAt,
        },
      });

      // Auto-publish the post's photo as an Instagram Story alongside the
      // feed post - no separate UI for this, it just happens whenever a post
      // with media targets Instagram. Facebook Stories aren't supported by
      // Zernio at all, so this is Instagram-only. Best-effort: a story
      // failure must never fail the (already-succeeded) main post publish.
      // Default (storyTemplate "none"/omitted) is the raw post photo,
      // unmodified - the branded template is opt-in, see PostSection.tsx.
      let story: { published: boolean; error?: string } | undefined;
      const instagramAccount = accountByPlatform.get("instagram");
      if (instagramAccount && mediaItems.length > 0) {
        try {
          let storyMediaItem = mediaItems[0];
          if (storyTemplate && storyTemplate !== "none") {
            const label = storyTemplate === "series" ? seriesName?.trim() || "SERIA" : undefined;
            const storyImageUrl = await renderStoryImageUrl({
              photoUrl: mediaItems[0].url,
              heading: post.heading,
              content: post.content,
              label,
            });
            if (storyImageUrl) {
              storyMediaItem = { type: "image", url: storyImageUrl };
            }
          }

          await zernio.createZernioPost(apiKey, {
            profileId: zernioProfileId,
            content: "",
            platforms: [
              {
                platform: zernio.toZernioPlatformSlug("instagram"),
                accountId: instagramAccount.zernioAccountId,
                platformSpecificData: { contentType: "story" },
              },
            ],
            mediaItems: [storyMediaItem],
            publishNow: mode === "now" ? true : undefined,
            scheduledFor: mode === "schedule" ? scheduledFor : undefined,
          });
          story = { published: true };
        } catch (err) {
          console.error("Auto-story publish failed:", err);
          story = { published: false, error: err instanceof HttpError ? err.message : "Nie udało się opublikować relacji." };
        }
      }

      res.json({ post: updated, zernio: result, story });
    } catch (err) {
      const message = err instanceof HttpError ? err.message : "Nie udało się opublikować posta.";
      await prisma.post.update({ where: { id: post.id }, data: { publishError: message } });
      throw err;
    }
  })
);

export default router;
