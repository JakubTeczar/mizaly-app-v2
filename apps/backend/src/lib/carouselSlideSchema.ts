// Zod validation for a CarouselSlide (packages/shared/src/index.ts) - shared
// by routes/posts.ts (Post.carouselSlides) and routes/admin.ts
// (Organization.closingSlideTemplate), since both accept the same shape from
// the same client-side canvas editor (packages/shared/src/carousel/
// SlideCanvasEditor.tsx).
import { z } from "zod";

export const carouselTextLayerSchema = z.object({
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

export const carouselImageLayerSchema = z.object({
  id: z.string(),
  url: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const carouselSlideSchema = z.object({
  order: z.number(),
  backgroundImageUrl: z.string().optional(),
  backgroundImageX: z.number().optional(),
  backgroundImageY: z.number().optional(),
  backgroundImageScale: z.number().optional(),
  textLayers: z.array(carouselTextLayerSchema).default([]),
  imageLayers: z.array(carouselImageLayerSchema).default([]),
});
