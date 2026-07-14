import { buildFontsTag, escapeHtml, fill, readTemplate, truncateDescription, type RenderMode } from "./templateUtils";

export interface CarouselSlideTemplateParams {
  backgroundImageUrl?: string;
  heading?: string;
  text?: string;
  mode?: RenderMode;
  baseUrl?: string;
}

// Renders a single carousel slide (templates/carousel.html + .css) to a full
// HTML document ready to hand to render.ts, same pattern as
// storyTemplate.ts's buildStoryHtml but square (1080x1080) and without a
// fixed header - background photo is optional (plain color background if
// omitted), and both heading/text are optional so a slide can be photo-only.
export function buildCarouselSlideHtml(params: CarouselSlideTemplateParams): string {
  const tpl = readTemplate("carousel");
  const text = params.text ? truncateDescription(params.text, 4, 320) : "";

  return fill(tpl, {
    fontsTag: buildFontsTag(params.mode ?? "file", params.baseUrl),
    bgPhoto: params.backgroundImageUrl
      ? `<img class="bg-photo" src="${escapeHtml(params.backgroundImageUrl)}" alt="" />`
      : "",
    headingBox: params.heading ? `<div class="text__heading">${escapeHtml(params.heading)}</div>` : "",
    textBox: text ? `<div class="text__body">${escapeHtml(text)}</div>` : "",
  });
}
