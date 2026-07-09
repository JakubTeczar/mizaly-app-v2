// Local-disk re-hosting for scraped Instagram images (see
// jobs/inspirationScrapeJob.ts). Instagram's CDN (scontent-*.cdninstagram.com)
// blocks hotlinking from other domains, so serving the original URL straight
// to the browser often 403s, and the URLs are short-lived signed links anyway.
// These images are only ever displayed inside our own app (never sent to
// Zernio, which needs a *public* URL for actual publishing) - saving locally
// and serving as a static file is enough for that.
import fs from "fs";
import path from "path";

const STORAGE_DIR = path.join(__dirname, "..", "..", "storage", "inspiration");
export const INSPIRATION_IMAGES_ROUTE = "/media/inspiration";

fs.mkdirSync(STORAGE_DIR, { recursive: true });

function extensionFromContentType(contentType: string | null): string {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  return "jpg";
}

// Fetches `remoteUrl` server-side and saves it under `id.<ext>`, overwriting
// any previous copy (re-scrapes refresh the same post id). Returns the public
// path to mount behind BACKEND_PUBLIC_URL, e.g. "/media/inspiration/123.jpg".
export async function saveImageLocally(remoteUrl: string, id: string): Promise<string> {
  const res = await fetch(remoteUrl);
  if (!res.ok) {
    throw new Error(`Failed to download image (${res.status}): ${remoteUrl}`);
  }

  const ext = extensionFromContentType(res.headers.get("content-type"));
  const filename = `${id}.${ext}`;
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(STORAGE_DIR, filename), buffer);

  return `${INSPIRATION_IMAGES_ROUTE}/${filename}`;
}
