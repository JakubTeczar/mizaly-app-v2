// Media upload for posts/reels. Zernio's publish API requires a publicly
// reachable URL for each media item (see zernio.ts) - the client can't just
// send a local blob, so it uploads through us to Cloudinary first and uses
// the returned secure URL as mediaUrls/videoUrl.
import { v2 as cloudinary } from "cloudinary";

export function isCloudinaryConfigured(): boolean {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

export interface UploadResult {
  url: string;
  resourceType: string;
}

// `source` is either a data: URI (e.g. "data:image/png;base64,...", as
// produced by FileReader.readAsDataURL on the client) or a plain https:// URL
// - Cloudinary's upload API fetches remote URLs server-side itself, which is
// also how we re-host Instagram's scraped image URLs (see
// jobs/inspirationScrapeJob.ts): Instagram's CDN blocks hotlinking from other
// domains, so serving the original scontent-*.cdninstagram.com URL straight
// to the browser often 403s. Re-hosting on Cloudinary avoids that and also
// outlives Instagram's short-lived signed URL expiry.
export async function uploadMedia(source: string, folder: string): Promise<UploadResult> {
  configureCloudinary();
  const result = await cloudinary.uploader.upload(source, {
    folder,
    resource_type: "auto",
  });
  return { url: result.secure_url, resourceType: result.resource_type };
}
