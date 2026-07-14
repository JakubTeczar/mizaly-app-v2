// Scrape.do proxy client (https://scrape.do/documentation/). Every request is
// forwarded through their rotating proxy pool, which is what lets us fetch
// bot-protected pages (Instagram etc.) from a plain backend process.
//
// API shape: GET https://api.scrape.do/?token=KEY&url=<encoded target>&...flags
// - `super=true` switches from datacenter to residential/mobile IPs (more
//   expensive per request, but required for stubborn targets).
// - `render=true` spins up their headless browser (JS execution).
// - `extraHeaders=true` + request headers prefixed with `sd-` forwards custom
//   headers to the target (e.g. Instagram's x-ig-app-id).
// - `geoCode=<cc>` pins the exit IP country.
//
// Successful responses (2xx) return the target's raw body. Used only by the
// experimental "Testowa" scraping playground for now - see routes/testowa.ts.

const SCRAPE_DO_BASE_URL = "https://api.scrape.do/";

export function isScrapeDoConfigured(): boolean {
  return Boolean(process.env.SCRAPE_DO_KEY);
}

export interface ScrapeDoOptions {
  render?: boolean;
  superProxy?: boolean;
  geoCode?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function scrapeDoFetch(targetUrl: string, options: ScrapeDoOptions = {}): Promise<string> {
  const token = process.env.SCRAPE_DO_KEY;
  if (!token) {
    throw new Error("SCRAPE_DO_KEY is not configured.");
  }

  const params = new URLSearchParams({ token, url: targetUrl });
  if (options.render) params.set("render", "true");
  if (options.superProxy) params.set("super", "true");
  if (options.geoCode) params.set("geoCode", options.geoCode);

  const requestHeaders: Record<string, string> = {};
  if (options.headers && Object.keys(options.headers).length > 0) {
    params.set("extraHeaders", "true");
    for (const [name, value] of Object.entries(options.headers)) {
      requestHeaders[`sd-${name}`] = value;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000);
  try {
    const res = await fetch(`${SCRAPE_DO_BASE_URL}?${params.toString()}`, {
      headers: requestHeaders,
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`Scrape.do request failed (${res.status}): ${body.slice(0, 300)}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}
