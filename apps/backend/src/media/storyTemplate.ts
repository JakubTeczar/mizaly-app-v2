import { buildFontsTag, escapeHtml, fill, readTemplate, truncateDescription, type RenderMode } from "./templateUtils";

export interface StoryTemplateParams {
  photoUrl: string;
  name: string;
  subtitle?: string;
  label?: string;
  title: string;
  description?: string;
  mode?: RenderMode;
  baseUrl?: string;
}

// Renders the "story" template (templates/story.html + .css) to a full HTML
// document ready to hand to render.ts (or served directly for live preview -
// see routes/mediaPreview.ts). Deliberately generic - photo, a name/subtitle
// header, headline and a short optional caption - so it works for any
// business or person, unlike the real-estate-specific template (available
// homes counter, investment name/city, website link pill) it was adapted from.
export function buildStoryHtml(params: StoryTemplateParams): string {
  const tpl = readTemplate("story");
  const description = params.description ? truncateDescription(params.description) : "";

  return fill(tpl, {
    fontsTag: buildFontsTag(params.mode ?? "file", params.baseUrl),
    photoSrc: params.photoUrl,
    name: escapeHtml(params.name),
    subtitleBox: params.subtitle ? `<div class="header__subtitle">${escapeHtml(params.subtitle)}</div>` : "",
    label: escapeHtml(params.label || "NOWY POST"),
    title: escapeHtml(params.title),
    descriptionBox: description
      ? `<div class="description"><div class="description__text">${escapeHtml(description)}</div></div>`
      : "",
  });
}
