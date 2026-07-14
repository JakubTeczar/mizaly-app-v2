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
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

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

// Fetches `remoteUrl` server-side and uploads it to R2 under `id.<ext>`,
// overwriting any previous copy (re-scrapes refresh the same post id).
// `fallbackExt` picks the extension when Instagram doesn't send a usable
// content-type. Returns the public path to request it back through
// routes/inspirationMedia.ts, e.g. "/media/inspiration/123.jpg".
export async function saveMediaToR2(remoteUrl: string, id: string, fallbackExt: "jpg" | "mp4"): Promise<string> {
  const res = await fetch(remoteUrl);
  if (!res.ok) {
    throw new Error(`Nie udało się pobrać pliku (${res.status}): ${remoteUrl}`);
  }

  const contentType = res.headers.get("content-type");
  const ext = extensionFromContentType(contentType, fallbackExt);
  const key = `${OBJECT_PREFIX}${id}.${ext}`;
  const buffer = Buffer.from(await res.arrayBuffer());

  await getClient().send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType || (ext === "mp4" ? "video/mp4" : "image/jpeg"),
    })
  );

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
