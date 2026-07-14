import fs from "fs";
import os from "os";
import path from "path";
import puppeteer from "puppeteer";
import { pathToFileURL } from "url";

const DEFAULT_VIEWPORT = { width: 1080, height: 1920 };

export interface Viewport {
  width: number;
  height: number;
}

// Renders an HTML string to a JPEG buffer via headless Chromium - used to
// turn a filled-in template (see storyTemplate.ts/carouselTemplate.ts) into
// an actual image. Writes to a temp file rather than page.setContent(),
// because setContent() resolves relative/file:// asset URLs against
// about:blank, which breaks the local font/logo references baked into the
// HTML. `viewport` defaults to the Instagram Story size (1080x1920) so
// existing callers are unaffected; pass a different size (e.g. 1080x1080 for
// a carousel slide) to match the template being rendered.
export async function renderHtmlToJpeg(html: string, viewport: Viewport = DEFAULT_VIEWPORT): Promise<Buffer> {
  return Promise.race([
    doRender(html, viewport),
    new Promise<Buffer>((_, reject) =>
      setTimeout(() => reject(new Error("Story render timeout after 45s")), 45000)
    ),
  ]);
}

async function doRender(html: string, viewport: Viewport): Promise<Buffer> {
  const tmpFile = path.join(os.tmpdir(), `story_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.html`);
  await fs.promises.writeFile(tmpFile, html, "utf8");

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    headless: true,
    // On Railway (see apps/backend/nixpacks.toml) Chromium comes from Nix
    // rather than puppeteer's own downloaded copy - PUPPETEER_EXECUTABLE_PATH
    // points at that binary. Locally this is unset, so puppeteer falls back
    // to its own bundled Chromium exactly as before.
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(tmpFile).href, { waitUntil: "load", timeout: 15000 });

    const buffer = await page.screenshot({
      type: "jpeg",
      quality: 92,
      clip: { x: 0, y: 0, ...viewport },
    });

    return Buffer.from(buffer);
  } finally {
    // Force-close within 5s so a hung renderer can't stall the request forever.
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    await fs.promises.unlink(tmpFile).catch(() => {});
  }
}
