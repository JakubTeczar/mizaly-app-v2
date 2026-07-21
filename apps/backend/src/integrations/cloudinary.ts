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
// produced by FileReader.readAsDataURL on the client, or assembled server-side
// from a fetched buffer - see lib/contentTransfer.ts) or a plain https:// URL
// that Cloudinary's upload API fetches remote-side itself.
export async function uploadMedia(source: string, folder: string, options?: { format?: string }): Promise<UploadResult> {
  configureCloudinary();
  const result = await cloudinary.uploader.upload(source, {
    folder,
    resource_type: "auto",
    ...(options?.format ? { format: options.format } : {}),
  });
  return { url: result.secure_url, resourceType: result.resource_type };
}
