// Client for the Zernio API (https://zernio.com) - unified REST API for
// publishing/scheduling/analytics/engagement across 15+ social networks.
//
// Endpoint shapes below were confirmed against the live API (docs.zernio.com
// / llms.txt only gave an approximate summary). Key things that aren't
// obvious from a quick read of the docs:
//
//   - Zernio has its own "profile" concept (their multi-tenant grouping) that
//     must exist before any social account can be connected - see
//     createProfile() and ensureZernioProfileId() in
//     integrations/zernioProfile.ts. Profile ids are Zernio's own Mongo
//     ObjectIds, unrelated to our Organization.id.
//   - The authUrl returned by initiateConnect() points the end user's
//     browser at the *social platform's* OAuth screen, whose redirect_uri is
//     registered as Zernio's own hosted callback (e.g.
//     https://zernio.com/api/v1/connect/instagram/callback) - NOT our
//     `redirect_url` param. Zernio exchanges the code and finalizes the
//     connection on its own side; our `redirect_url` is only where it sends
//     the browser afterwards, purely so the user lands back in our app. That
//     means our own callback route can't rely on Zernio's `state`/`code` for
//     anything - we tag our `redirect_url` with our own correlation id and,
//     on callback, just re-fetch listAccounts() to pick up what changed.
//
// NOT built yet (later milestones, per docs/ROADMAP.md):
//   - Webhook receiver for engagement events (new comments/DMs)

import { HttpError } from "../lib/httpError";

export const ZERNIO_BASE_URL = "https://zernio.com/api/v1";

interface ZernioRequestOptions {
  apiKey: string;
  method?: string;
  path: string;
  body?: unknown;
}

// Every call site resolves its own apiKey via resolveZernioApiKey()
// (integrations/zernioApiKeys.ts) based on the acting user's assignment -
// there is no longer a single global key read from env here, since Zernio
// caps each key at 2 connected accounts and different users/orgs may be on
// different keys.
async function zernioFetch({ apiKey, method = "GET", path, body }: ZernioRequestOptions): Promise<Response> {
  return fetch(`${ZERNIO_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function parseOrThrow(res: Response, context: string): Promise<any> {
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data: any = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const message = (data && (data.message || data.error)) || `Zernio ${context} failed (${res.status})`;
    throw new HttpError(res.status >= 400 && res.status < 500 ? 400 : 502, message);
  }
  return data;
}

// Zernio's own multi-tenant concept: a "profile" must exist before any
// social account can be connected to it (workflow: create profile -> connect
// accounts -> schedule posts). Profile ids are Zernio's MongoDB ObjectIds,
// unrelated to our own Organization.id - see ensureZernioProfileId() in
// src/routes/socialAccounts.ts for how the two are linked.
export async function createProfile(apiKey: string, name: string): Promise<{ id: string }> {
  const res = await zernioFetch({ apiKey, method: "POST", path: "/profiles", body: { name } });
  const data = await parseOrThrow(res, "create-profile");
  // Response shape: { message, profile: { _id, name, ... } }
  const id = data?.profile?._id || data?.profile?.id || data?._id || data?.id;
  if (!id) {
    throw new HttpError(502, "Zernio nie zwróciło identyfikatora profilu.");
  }
  return { id };
}

export interface ZernioConnectInitiateResult {
  authUrl: string;
  state: string;
}

// Our SocialPlatform enum (packages/shared) uses "x" for X/Twitter, matching
// the platform's current branding, but Zernio's /connect/{platform} slug is
// still "twitter" (confirmed against the live API - "x" returns "Platform
// not supported"). Only platforms with a standard OAuth redirect flow are
// connectable via this endpoint; others (whatsapp, telegram, discord,
// snapchat, bluesky, google_business) use different connection mechanisms
// that aren't wired up yet, so callers should only offer the ones below.
const PLATFORM_SLUG_OVERRIDES: Record<string, string> = { x: "twitter" };

export const OAUTH_CONNECTABLE_PLATFORMS = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "linkedin",
  "facebook",
  "threads",
  "pinterest",
  "reddit",
] as const;

export function toZernioPlatformSlug(platform: string): string {
  return PLATFORM_SLUG_OVERRIDES[platform] || platform;
}

// GET /v1/connect/{platform}?profileId=...&redirect_url=...
// Returns a platform authorization URL to send the end user's browser to.
// `state` is Zernio's own internal CSRF/matching token for its handshake
// with the platform - we don't need to parse or persist it ourselves (see
// the module comment above), but it's returned in case it's ever useful for
// debugging.
export async function initiateConnect(
  apiKey: string,
  platform: string,
  profileId: string,
  redirectUrl: string
): Promise<ZernioConnectInitiateResult> {
  const qs = new URLSearchParams({ profileId, redirect_url: redirectUrl });
  const res = await zernioFetch({ apiKey, path: `/connect/${encodeURIComponent(toZernioPlatformSlug(platform))}?${qs.toString()}` });
  const data = await parseOrThrow(res, "connect-initiate");
  if (!data?.authUrl) {
    throw new HttpError(502, "Zernio nie zwróciło adresu autoryzacji.");
  }
  return { authUrl: data.authUrl, state: data.state };
}

export interface ZernioAccount {
  id?: string;
  _id?: string;
  platform?: string;
  username?: string;
  displayName?: string;
  name?: string;
  [key: string]: unknown;
}

// POST /v1/connect/{platform} - documented as an "optional manual completion
// step". Not used by our default flow (Zernio completes the exchange on its
// own hosted callback before ever redirecting back to us - see the module
// comment above), but kept here in case a future platform/flow needs it.
export async function completeConnect(
  apiKey: string,
  platform: string,
  params: { code: string; state: string; profileId: string }
): Promise<ZernioAccount> {
  const res = await zernioFetch({ apiKey, method: "POST", path: `/connect/${encodeURIComponent(platform)}`, body: params });
  return parseOrThrow(res, "connect-complete");
}

// GET /v1/accounts?profileId=...
export async function listAccounts(apiKey: string, profileId: string): Promise<ZernioAccount[]> {
  const res = await zernioFetch({ apiKey, path: `/accounts?profileId=${encodeURIComponent(profileId)}` });
  const data = await parseOrThrow(res, "list-accounts");
  if (Array.isArray(data)) return data;
  return data?.accounts ?? data?.data ?? [];
}

// DELETE /v1/accounts/{accountId}
export async function deleteAccount(apiKey: string, accountId: string): Promise<void> {
  const res = await zernioFetch({ apiKey, method: "DELETE", path: `/accounts/${encodeURIComponent(accountId)}` });
  if (!res.ok && res.status !== 404) {
    await parseOrThrow(res, "delete-account");
  }
}

const PLATFORM_SLUG_FROM_ZERNIO: Record<string, string> = { twitter: "x" };

// Normalizes a Zernio account record into the fields our SocialAccount model
// cares about. `fallbackPlatform` covers the connect-complete response, which
// may not echo the platform back explicitly. Reverses toZernioPlatformSlug()
// so our own SocialPlatform enum values ("x") are what get stored, not
// Zernio's ("twitter").
export function mapZernioAccount(account: ZernioAccount, fallbackPlatform?: string) {
  const rawPlatform = (account.platform || fallbackPlatform || "instagram") as string;
  return {
    zernioAccountId: String(account._id || account.id),
    platform: PLATFORM_SLUG_FROM_ZERNIO[rawPlatform] || rawPlatform,
    displayName: account.displayName || account.name || account.username || "Połączone konto",
  };
}

// First-comment auto-posting is only supported by Zernio for these
// platforms (confirmed against docs.zernio.com) - it's sent per-target via
// `platformSpecificData.firstComment`, not as a root-level field. Instagram
// has no equivalent, so a firstComment on an Instagram-only post is silently
// unused - see routes/posts.ts.
export const FIRST_COMMENT_SUPPORTED_PLATFORMS = ["facebook", "linkedin"] as const;

// Instagram Stories, confirmed against docs.zernio.com: set via
// `platformSpecificData.contentType: "story"` on the instagram target.
// Facebook Stories are NOT supported by Zernio's API at all - don't attempt
// this for any platform other than instagram (see routes/posts.ts).
export interface ZernioPublishTarget {
  platform: string;
  accountId: string;
  platformSpecificData?: { firstComment?: string; contentType?: "story" };
}

export interface ZernioMediaItem {
  type: "image" | "video";
  url: string;
}

export interface ZernioPublishParams {
  profileId: string;
  content: string;
  title?: string;
  platforms: ZernioPublishTarget[];
  mediaItems?: ZernioMediaItem[];
  publishNow?: boolean;
  scheduledFor?: string;
}

export interface ZernioPublishResult {
  id: string;
  status: string;
  scheduledFor?: string;
  platforms: { platform: string; accountId: string; status: string }[];
}

// POST /v1/posts - creates and (depending on publishNow/scheduledFor)
// publishes or schedules a post to one connected account per platform.
// `platforms[].platform` must already be a Zernio slug (see
// toZernioPlatformSlug) - callers build that mapping themselves since they're
// the ones resolving which local SocialAccount goes with which platform.
export async function createZernioPost(apiKey: string, params: ZernioPublishParams): Promise<ZernioPublishResult> {
  const res = await zernioFetch({ apiKey, method: "POST", path: "/posts", body: params });
  const data = await parseOrThrow(res, "create-post");
  // Response shape for a successful publish isn't confirmed by the docs -
  // defensively check both top-level fields and a nested `post` wrapper
  // (mirrors the `{ message, profile: {...} }` shape seen from POST
  // /profiles). A 2xx response means Zernio already accepted/published the
  // post regardless of whether we can find its id, so a parsing miss here
  // must NOT be treated as a failure - see the caller in routes/posts.ts.
  const id = data?.post?._id || data?.post?.id || data?._id || data?.id;
  if (!id) {
    console.warn("Zernio create-post response had no recognizable id field:", JSON.stringify(data));
  }
  return {
    id: id ? String(id) : "",
    status: data?.post?.status ?? data?.status ?? (params.publishNow ? "published" : "scheduled"),
    scheduledFor: data?.post?.scheduledFor ?? data?.scheduledFor,
    platforms: data?.post?.platforms ?? data?.platforms ?? [],
  };
}

// --- Analytics ---
//
// The endpoint list in Zernio's docs/llms.txt is only partially accurate -
// confirmed against the live API:
//   - /analytics, /analytics/daily-metrics, /analytics/posting-frequency and
//     the platform-specific insight endpoints (e.g.
//     /analytics/facebook/page-insights) work and return real data.
//   - /analytics/best-time-to-post and /analytics/follower-stats 404 (don't
//     exist on this account/plan, despite being documented).
// Unlike /connect and /accounts, `profileId` is NOT required to get a 200
// from /analytics - but omitting it silently scopes to the wrong/empty data
// set instead of erroring, and a profileId the API key doesn't own 403s. So
// always pass the caller's own zernioProfileId (see ensureZernioProfileId).

export interface ZernioAnalyticsPostAnalytics {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  views?: number;
  engagementRate?: number;
}

export interface ZernioAnalyticsPost {
  _id: string;
  content?: string;
  status: string;
  publishedAt?: string;
  scheduledFor?: string;
  platform?: string;
  platformPostUrl?: string;
  analytics?: ZernioAnalyticsPostAnalytics;
}

export interface ZernioAnalyticsAccount {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
  followersCount?: number | null;
}

export interface ZernioAnalyticsOverviewResponse {
  overview: {
    totalPosts: number;
    publishedPosts: number;
    scheduledPosts: number;
    lastSync?: string;
  };
  posts: ZernioAnalyticsPost[];
  accounts: ZernioAnalyticsAccount[];
  hasAnalyticsAccess?: boolean;
}

// GET /v1/analytics?profileId=... - overview + recent posts (each with
// per-post analytics) + connected accounts, for one Zernio profile.
export async function getAnalyticsOverview(apiKey: string, profileId: string): Promise<ZernioAnalyticsOverviewResponse> {
  const res = await zernioFetch({ apiKey, path: `/analytics?profileId=${encodeURIComponent(profileId)}` });
  return parseOrThrow(res, "analytics-overview");
}

interface ZernioDailyMetricPoint {
  date: string;
  postCount: number;
  metrics: {
    impressions: number;
    reach: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    clicks: number;
    views: number;
  };
}

interface ZernioPlatformBreakdown {
  platform: string;
  postCount: number;
  impressions: number;
  reach: number;
}

export interface ZernioDailyMetricsResponse {
  dailyData: ZernioDailyMetricPoint[];
  platformBreakdown: ZernioPlatformBreakdown[];
}

// GET /v1/analytics/daily-metrics?profileId=...&fromDate&toDate - defaults to
// a 180-day window when fromDate/toDate are omitted (per Zernio docs).
export async function getDailyMetrics(apiKey: string, profileId: string, fromDate?: string, toDate?: string): Promise<ZernioDailyMetricsResponse> {
  const qs = new URLSearchParams({ profileId });
  if (fromDate) qs.set("fromDate", fromDate);
  if (toDate) qs.set("toDate", toDate);
  const res = await zernioFetch({ apiKey, path: `/analytics/daily-metrics?${qs.toString()}` });
  return parseOrThrow(res, "analytics-daily-metrics");
}

export interface ZernioPostingFrequencyResponse {
  frequency: Array<{
    platform: string;
    posts_per_week: number;
    avg_engagement_rate: number;
    avg_engagement: number;
    weeks_count: number;
  }>;
}

// GET /v1/analytics/posting-frequency?accountId=... - per connected account
// (confirmed working without profileId, unlike the overview/daily-metrics
// endpoints above).
export async function getPostingFrequency(apiKey: string, accountId: string): Promise<ZernioPostingFrequencyResponse> {
  const res = await zernioFetch({ apiKey, path: `/analytics/posting-frequency?accountId=${encodeURIComponent(accountId)}` });
  return parseOrThrow(res, "analytics-posting-frequency");
}
