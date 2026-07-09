// Center-crops an image (client-side, via canvas) into Instagram's safe
// aspect-ratio range before it ever leaves the browser. Instagram feed posts
// reject anything outside ~0.8:1 (4:5 portrait) to 1.91:1 (landscape) - see
// the error surfaced by Zernio/Instagram when publishing. Rather than making
// the user crop manually, we clamp automatically: images already inside the
// range pass through untouched, others get center-cropped to the nearest
// edge of the allowed range.
const MIN_RATIO = 0.8; // 4:5 portrait
const MAX_RATIO = 1.91; // landscape

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Nie udało się wczytać obrazu."));
    img.src = dataUrl;
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Nie udało się odczytać pliku."));
    reader.readAsDataURL(file);
  });
}

// Returns a JPEG data URL, cropped to fit MIN_RATIO..MAX_RATIO. If the image
// already fits, returns the original dataUrl unchanged (no re-encoding).
export async function cropToSafeAspectRatio(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const { naturalWidth: width, naturalHeight: height } = img;
  const ratio = width / height;

  if (ratio >= MIN_RATIO && ratio <= MAX_RATIO) {
    return dataUrl;
  }

  let cropWidth = width;
  let cropHeight = height;
  if (ratio < MIN_RATIO) {
    // Too tall/narrow - crop height down to a 4:5 portrait.
    cropHeight = Math.round(width / MIN_RATIO);
  } else {
    // Too wide - crop width down to the 1.91:1 landscape limit.
    cropWidth = Math.round(height * MAX_RATIO);
  }

  const sourceX = Math.round((width - cropWidth) / 2);
  const sourceY = Math.round((height - cropHeight) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Canvas unavailable for some reason - fall back to the uncropped image
    // rather than blocking the whole flow; Zernio/Instagram will still
    // validate and surface a clear error if it's rejected.
    return dataUrl;
  }

  ctx.drawImage(img, sourceX, sourceY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return canvas.toDataURL("image/jpeg", 0.9);
}
