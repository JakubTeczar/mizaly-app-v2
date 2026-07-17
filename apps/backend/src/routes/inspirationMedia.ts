// Streaming proxy for scraped Instagram media (images + Reels) stored in
// Cloudflare R2 (see lib/r2Store.ts). The bucket is private, so this route
// is the only way the mobile app gets these files - there's no public
// R2/CDN URL to link to directly. Mounted at INSPIRATION_MEDIA_ROUTE
// ("/media/inspiration") in index.ts.
import { Router } from "express";
import { Readable } from "stream";
import { getMediaObject, getMediaObjectMeta } from "../lib/r2Store";

const router = Router();

router.get("/:filename", async (req, res) => {
  try {
    // A post's media is written once under a deterministic key (id.ext, see
    // saveMediaToR2) and never overwritten afterwards, so it's safe to tell
    // clients/proxies to cache it indefinitely - `immutable` skips even the
    // revalidation request for as long as the browser keeps the entry.
    // If-None-Match still covers a client that revalidates anyway (came back
    // after evicting its cache, or an intermediate proxy) - a HEAD first
    // means a 304 doesn't pull the file's bytes through this backend at all.
    const ifNoneMatch = req.headers["if-none-match"];
    if (ifNoneMatch) {
      const meta = await getMediaObjectMeta(req.params.filename);
      if (meta.ETag && meta.ETag === ifNoneMatch) {
        if (meta.ContentType) res.setHeader("Content-Type", meta.ContentType);
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("ETag", meta.ETag);
        res.status(304).end();
        return;
      }
    }

    const object = await getMediaObject(req.params.filename);
    if (object.ContentType) res.setHeader("Content-Type", object.ContentType);
    if (object.ETag) res.setHeader("ETag", object.ETag);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    if (object.Body instanceof Readable) {
      // Without this, a stream error partway through (e.g. a socket that goes
      // stale mid-transfer) leaves the response hanging forever instead of
      // ending it - the browser then shows a permanently-loading broken
      // image/video rather than a failed one.
      object.Body.on("error", (err) => {
        console.error(`[inspiration-media] Stream error for ${req.params.filename}:`, err);
        res.destroy();
      });
      object.Body.pipe(res);
    } else {
      res.status(502).end();
    }
  } catch (err: any) {
    if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
      res.status(404).end();
      return;
    }
    console.error(`[inspiration-media] Failed to stream ${req.params.filename}:`, err);
    res.status(502).end();
  }
});

export default router;
