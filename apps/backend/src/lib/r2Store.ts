// Cloudflare R2 storage for scraped Instagram media (images + Reels video
// files - see jobs/inspirationScrapeJob.ts). Replaces the old local-disk
// re-hosting (lib/localImageStore.ts, now removed) for the same reason
// images were re-hosted in the first place: Instagram's CDN blocks
// hotlinking from other domains and its URLs are short-lived signed links.
// R2 instead of the backend's own disk so storage isn't tied to a single
// server instance/volume.
//
// The bucket is private (S3 API access only, no public r2.dev/custom
// domain), so objects are streamed back to the app through
// routes/inspirationMedia.ts rather than linked to directly.
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

// Guardrails so scraping can't silently push huge files or blow past a
// storage budget on Cloudflare R2 (billed per GB - see docs/Backlog.md).
const MAX_MEDIA_SIZE_BYTES = 50 * 1024 * 1024; // 50MB per file
const MAX_BUCKET_SIZE_BYTES = 8 * 1024 * 1024 * 1024; // 8GB total for this bucket
// Listing every object to sum sizes is real work - don't do it before every
// single upload in a scrape run (dozens of uploads/run). Cache it briefly and
// keep it in sync in-memory as uploads happen; a full recount every 5 minutes
// self-corrects any drift.
const BUCKET_SIZE_CACHE_MS = 5 * 60 * 1000;

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const ENDPOINT = process.env.R2_ENDPOINT || (ACCOUNT_ID ? `https://${ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);

export const INSPIRATION_MEDIA_ROUTE = "/media/inspiration";

// Flat prefix inside the bucket - this bucket (mizaly-reels-storage) is
// dedicated to Inspiracje media for now, but the prefix keeps room for
// other sources later without key collisions.
const OBJECT_PREFIX = "instagram/";

export function isR2Configured(): boolean {
  return Boolean(ACCESS_KEY_ID && SECRET_ACCESS_KEY && ENDPOINT && BUCKET_NAME);
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!isR2Configured()) {
    throw new Error(
      "Cloudflare R2 nie jest skonfigurowane (brak R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT / R2_BUCKET_NAME w apps/backend/.env)."
    );
  }
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: ENDPOINT,
      credentials: { accessKeyId: ACCESS_KEY_ID!, secretAccessKey: SECRET_ACCESS_KEY! },
      // Without an explicit timeout, a socket that goes stale mid-request (seen
      // in practice under the concurrent PutObject traffic from the scrape
      // jobs) hangs forever instead of erroring - the frontend then shows a
      // broken image/video that never finishes loading. maxSockets raised from
      // the SDK default (50) since scraping and page views share this client.
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 5_000,
        requestTimeout: 15_000,
        socketTimeout: 15_000,
        httpsAgent: { maxSockets: 100 },
      }),
    });
  }
  return client;
}

function extensionFromContentType(contentType: string | null, fallback: "jpg" | "mp4"): string {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  if (contentType?.includes("mp4") || contentType?.includes("video")) return "mp4";
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return "jpg";
  return fallback;
}

let cachedBucketSizeBytes: number | null = null;
let cachedBucketSizeAt = 0;

// Real total (sums every object's Size, paginated) - the only reliable source
// since the bucket already had files in it before this budget existed, so an
// in-memory counter starting at 0 would undercount. Cached/incremented
// in-memory between calls (see BUCKET_SIZE_CACHE_MS) so this doesn't run a
// full listing before every single upload in a scrape run.
async function getBucketSizeBytes(): Promise<number> {
  const now = Date.now();
  if (cachedBucketSizeBytes !== null && now - cachedBucketSizeAt < BUCKET_SIZE_CACHE_MS) {
    return cachedBucketSizeBytes;
  }

  let total = 0;
  let continuationToken: string | undefined;
  do {
    const page = await getClient().send(
      new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix: OBJECT_PREFIX, ContinuationToken: continuationToken })
    );
    total += (page.Contents ?? []).reduce((sum, obj) => sum + (obj.Size ?? 0), 0);
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);

  cachedBucketSizeBytes = total;
  cachedBucketSizeAt = now;
  return total;
}

// Fetches `remoteUrl` server-side and uploads it to R2 under `id.<ext>`,
// overwriting any previous copy (re-scrapes refresh the same post id). Throws
// (caller already catches and falls back to the raw/possibly-broken URL
// rather than dropping the post, see jobs/inspirationScrapeJob.ts) if the
// file is over MAX_MEDIA_SIZE_BYTES or would push the bucket over
// MAX_BUCKET_SIZE_BYTES. `fallbackExt` picks the extension when Instagram
// doesn't send a usable content-type. Returns the public path to request it
// back through routes/inspirationMedia.ts, e.g. "/media/inspiration/123.jpg".
export async function saveMediaToR2(remoteUrl: string, id: string, fallbackExt: "jpg" | "mp4"): Promise<string> {
  const res = await fetch(remoteUrl);
  if (!res.ok) {
    throw new Error(`Nie udało się pobrać pliku (${res.status}): ${remoteUrl}`);
  }

  const contentType = res.headers.get("content-type");
  const ext = extensionFromContentType(contentType, fallbackExt);
  const key = `${OBJECT_PREFIX}${id}.${ext}`;
  const buffer = Buffer.from(await res.arrayBuffer());

  if (buffer.length > MAX_MEDIA_SIZE_BYTES) {
    throw new Error(
      `Plik przekracza limit ${MAX_MEDIA_SIZE_BYTES / (1024 * 1024)}MB ` +
        `(${(buffer.length / (1024 * 1024)).toFixed(1)}MB): ${remoteUrl}`
    );
  }

  const currentTotal = await getBucketSizeBytes();
  if (currentTotal + buffer.length > MAX_BUCKET_SIZE_BYTES) {
    throw new Error(
      `Limit miejsca w R2 (${MAX_BUCKET_SIZE_BYTES / (1024 * 1024 * 1024)}GB) zostałby przekroczony ` +
        `(obecnie ${(currentTotal / (1024 * 1024 * 1024)).toFixed(2)}GB) - pomijam upload dla ${id}.`
    );
  }

  await getClient().send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType || (ext === "mp4" ? "video/mp4" : "image/jpeg"),
    })
  );

  cachedBucketSizeBytes = currentTotal + buffer.length;

  return `${INSPIRATION_MEDIA_ROUTE}/${id}.${ext}`;
}

// Streams an object back out of R2 by its filename (as returned by
// saveMediaToR2, e.g. "123.jpg") - used by routes/inspirationMedia.ts since
// the bucket is private and can't just be linked to directly.
export function getMediaObject(filename: string) {
  return getClient().send(
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: `${OBJECT_PREFIX}${filename}` })
  );
}

// Metadata-only (no body) - lets routes/inspirationMedia.ts answer a
// conditional GET (If-None-Match) with a 304 without pulling the file's
// bytes through the backend, on top of the browser's own max-age cache.
export function getMediaObjectMeta(filename: string) {
  return getClient().send(
    new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: `${OBJECT_PREFIX}${filename}` })
  );
}
