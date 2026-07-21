// gpt-4o-mini's per-minute token limit is shared across every classification/
// vision call made during a single scrape run (lib/contentClassification.ts,
// lib/mediaAnalysis.ts) - a burst of several dozen small calls in a row (e.g.
// an 8-slide carousel, or several posts back to back) can trip it even though
// each individual call is small. Without a retry, that 429 just silently
// degrades a post's data (falls back to an empty/"inne" result) - discovered
// by hand while dialing in the creator-audit pipeline against real posts.

// OpenAI's rate-limit headers report the reset window as e.g. "1m0.633s" or
// "58.264s" - parses that into milliseconds.
function parseOpenAiDuration(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(?:(\d+)m)?(\d+(?:\.\d+)?)s$/);
  if (!match) return null;
  const minutes = match[1] ? Number(match[1]) : 0;
  const seconds = Number(match[2]);
  return (minutes * 60 + seconds) * 1000;
}

export async function withOpenAiRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status !== 429 || attempt === maxAttempts) throw err;

      const headers = (err as { headers?: Record<string, string> })?.headers;
      const remainingTokens = Number(headers?.["x-ratelimit-remaining-tokens"]);
      const resetTokensMs = parseOpenAiDuration(headers?.["x-ratelimit-reset-tokens"]);
      const retryAfterMs = Number(headers?.["retry-after-ms"]);
      const retryAfterSec = Number(headers?.["retry-after"]);

      // retry-after-ms is misleadingly small when the whole per-minute budget
      // is exhausted (e.g. "48ms") - it's not the real reset window. When
      // remaining tokens is actually 0, the honest wait is the token-bucket's
      // own reset duration, not that hint.
      const waitMs =
        remainingTokens === 0 && resetTokensMs != null
          ? resetTokensMs
          : Number.isFinite(retryAfterMs)
            ? retryAfterMs
            : Number.isFinite(retryAfterSec)
              ? retryAfterSec * 1000
              : 2000 * attempt;

      console.warn(`[openai-retry] 429 rate limited, retrying in ${Math.round(waitMs)}ms (attempt ${attempt}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 65_000) + 250));
    }
  }
  throw lastErr;
}
