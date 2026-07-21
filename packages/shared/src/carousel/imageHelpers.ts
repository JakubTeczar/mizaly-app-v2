// Shared by mobile's and admin's carousel slide editors (see
// SlideCanvasEditor.tsx in this same folder) - file->dataUrl conversion and
// HEIC handling needed to add a background/inset image layer to a slide.
// Kept out of packages/shared/src/index.ts deliberately - see the module
// comment in SlideCanvasEditor.tsx for why.

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Nie udało się wczytać obrazu."));
    img.src = dataUrl;
  });
}

// Decodes just to read natural dimensions and fail fast on an undecodable
// source - used for inset photo layers, which (unlike the JPEG-only
// background) keep their original encoding so PNG/WEBP transparency survives.
export async function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  const img = await loadImage(dataUrl);
  return { width: img.naturalWidth, height: img.naturalHeight };
}

const HEIC_MIME_TYPES = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];

function isHeicFile(file: File): boolean {
  return HEIC_MIME_TYPES.includes(file.type.toLowerCase()) || /\.hei[cf]$/i.test(file.name);
}

// HEIC/HEIF (the default photo format on iPhone) can't be decoded by
// <img>/canvas in any browser except Safari, so it fails normalizeToJpeg
// below despite being a perfectly valid photo. Convert it to JPEG via a WASM
// decoder first - dynamically imported so an app that never sees a HEIC file
// doesn't pay for the ~500KB decoder in its bundle.
async function ensureDecodableBlob(file: File): Promise<Blob> {
  if (!isHeicFile(file)) return file;
  const heic2any = (await import("heic2any")).default;
  const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  return Array.isArray(converted) ? converted[0] : converted;
}

export async function fileToDataUrl(file: File): Promise<string> {
  const blob = await ensureDecodableBlob(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Nie udało się odczytać pliku."));
    reader.readAsDataURL(blob);
  });
}

// Decodes an image and re-encodes it as JPEG via canvas, without cropping.
// Used for photos that get center-cropped to a square later on (carousel
// slide backgrounds), but that still need to fail fast here on any remaining
// undecodable source instead of uploading successfully and only breaking
// later, silently, when the canvas renderer tries to display them.
export async function normalizeToJpeg(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.92);
}
