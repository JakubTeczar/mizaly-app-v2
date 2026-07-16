// Streaming proxy for scraped Instagram media (images + Reels) stored in
// Cloudflare R2 (see lib/r2Store.ts). The bucket is private, so this route
// is the only way the mobile app gets these files - there's no public
// R2/CDN URL to link to directly. Mounted at INSPIRATION_MEDIA_ROUTE
// ("/media/inspiration") in index.ts.
import { Router } from "express";
import { Readable } from "stream";
import { getMediaObject } from "../lib/r2Store";

const router = Router();

router.get("/:filename", async (req, res) => {
  try {
    const object = await getMediaObject(req.params.filename);
    if (object.ContentType) res.setHeader("Content-Type", object.ContentType);
    res.setHeader("Cache-Control", "public, max-age=86400");

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
