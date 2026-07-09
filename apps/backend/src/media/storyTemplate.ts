import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const ASSETS_DIR = path.join(__dirname, "assets");
const TEMPLATES_DIR = path.join(__dirname, "templates");
const FONTS_DIR = path.join(ASSETS_DIR, "fonts");
const FONTS_CSS_PATH = path.join(FONTS_DIR, "fonts.css");

function readTemplate(name: string): string {
  const html = fs.readFileSync(path.join(TEMPLATES_DIR, `${name}.html`), "utf8");
  const css = fs.readFileSync(path.join(TEMPLATES_DIR, `${name}.css`), "utf8");
  return html.replace("{{css}}", css);
}

type RenderMode = "file" | "http";

// 'file' mode: Puppeteer loads the filled template from a local temp file
// (see render.ts), so fonts must be referenced by file:// URL - fonts.css as
// copied from the mobile app's public/fonts still points at "/fonts/xxx.woff2",
// which only resolves against an HTTP server, so those get rewritten to
// absolute file:// paths pointing at our local copy in assets/fonts.
// 'http' mode: the template is served by our own Express app (see the
// /preview/story route) and viewed directly in a real browser for live CSS
// iteration, so it just links the same fonts.css over HTTP instead.
function buildFontsTag(mode: RenderMode, baseUrl?: string): string {
  if (mode === "http") {
    return `<link rel="stylesheet" href="${baseUrl}/media-assets/fonts/fonts.css">`;
  }
  const css = fs.readFileSync(FONTS_CSS_PATH, "utf8").replace(/url\(\/fonts\/([^)]+)\)/g, (_match, filename) =>
    `url(${pathToFileURL(path.join(FONTS_DIR, filename)).href})`
  );
  return `<style>${css}</style>`;
}

function fill(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((html, [key, val]) => html.split(`{{${key}}}`).join(val ?? ""), template);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Keeps the caption box short - full post captions can run to several
// paragraphs, which would either overflow the fixed-height box or force a
// tiny font. Cuts to the first `maxSentences` sentences, then to `maxChars`
// on a word boundary if that's still too long, appending "..." whenever
// anything was actually cut.
function truncateDescription(text: string, maxSentences = 2, maxChars = 200): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const sentences = trimmed.match(/[^.!?]+[.!?]*/g) || [trimmed];
  let result = sentences.slice(0, maxSentences).join("").trim();
  let wasTruncated = sentences.length > maxSentences;

  if (result.length > maxChars) {
    const cut = result.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(" ");
    result = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
    wasTruncated = true;
  }

  result = result.replace(/[.!?,;:\s]+$/, "");
  return wasTruncated ? `${result}...` : result;
}

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
