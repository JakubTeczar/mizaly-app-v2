// Wspólne typy i enumy używane przez backend, mobile i admin.
// Powinny odzwierciedlać model danych z docs/ROADMAP.md — przy zmianie schematu Prisma, zaktualizuj też ten plik.

export enum ContentStatus {
  DRAFT = "draft",
  SCHEDULED = "scheduled",
  PUBLISHED = "published",
}

export enum SocialPlatform {
  INSTAGRAM = "instagram",
  TIKTOK = "tiktok",
  YOUTUBE = "youtube",
  X = "x",
  LINKEDIN = "linkedin",
  FACEBOOK = "facebook",
  THREADS = "threads",
  PINTEREST = "pinterest",
  REDDIT = "reddit",
  BLUESKY = "bluesky",
  WHATSAPP = "whatsapp",
  TELEGRAM = "telegram",
  DISCORD = "discord",
  SNAPCHAT = "snapchat",
  GOOGLE_BUSINESS = "google_business",
}

export enum UserRole {
  OWNER = "owner",
  MEMBER = "member",
}

export interface Organization {
  id: string;
  name: string;
  aiContext: string | null;
  // Fixed last slide auto-appended to every new carousel this organization
  // creates (see CarouselSlideEditor.tsx in apps/mobile) - a full slide
  // (background + text/image layers), designed via the shared canvas editor
  // (packages/shared/src/carousel/SlideCanvasEditor.tsx) from admin's
  // ClosingSlideEditor.tsx. Null means no template configured yet.
  closingSlideTemplate: CarouselSlide | null;
  createdAt: string;
}

export interface User {
  id: string;
  organizationId: string;
  email: string;
  role: UserRole;
  createdAt: string;
  // Which configured Zernio API key (see admin's GET /api/admin/zernio-api-keys)
  // this user's Zernio calls are made with. Null means it falls back to the
  // legacy unsuffixed ZERNIO_API_KEY ("1"). Zernio caps each key at 2 accounts.
  zernioApiKeyId: string | null;
}

// One entry per ZERNIO_API_KEY* env var configured on the backend - see
// apps/backend/src/integrations/zernioApiKeys.ts. Used to populate the
// "Zernio API Key" select in the admin panel; never carries the key value.
export interface ZernioApiKeyOption {
  id: string;
  label: string;
}

export interface AdminUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface SocialAccount {
  id: string;
  organizationId: string;
  platform: SocialPlatform;
  zernioAccountId: string;
  displayName: string;
  connectedAt: string;
}

// One of an organization's own last few Instagram posts, cached for the
// "Przenoszenie treści z IG" tile (ContentTransferSection.tsx) so it can be
// cross-posted to other connected platforms without re-scraping on every view.
export interface ContentTransferPost {
  id: string;
  organizationId: string;
  instagramPostId: string;
  url: string;
  caption: string;
  imageUrl: string | null;
  videoUrl: string | null;
  isReel: boolean;
  postedAt: string | null;
  scrapedAt: string;
  // Which platforms this post has already been cross-posted to and when -
  // written by the publish endpoint right after a successful Zernio publish.
  transferredTo: Partial<Record<SocialPlatform, string>>;
}

export type CarouselTextFontFamily = "Bebas Neue" | "Gantari" | "Montserrat" | "Poppins";

export interface CarouselTextLayer {
  id: string;
  content: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fontFamily: CarouselTextFontFamily;
  color: string;
  align: "left" | "center" | "right";
}

export interface CarouselImageLayer {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CarouselSlide {
  order: number;
  backgroundImageUrl?: string;
  backgroundImageX?: number;
  backgroundImageY?: number;
  backgroundImageScale?: number;
  textLayers: CarouselTextLayer[];
  imageLayers: CarouselImageLayer[];
}

export interface Post {
  id: string;
  organizationId: string;
  heading: string;
  content: string;
  firstComment?: string;
  mediaUrls: string[];
  carouselSlides?: CarouselSlide[] | null;
  platforms: SocialPlatform[];
  status: ContentStatus;
  scheduledAt?: string;
  publishedAt?: string;
  createdAt: string;
  zernioPostId?: string | null;
  publishError?: string | null;
}

export interface Reel {
  id: string;
  organizationId: string;
  title: string;
  description: string;
  videoUrl: string;
  platforms: SocialPlatform[];
  status: ContentStatus;
  scheduledAt?: string;
  publishedAt?: string;
  createdAt: string;
}

export interface WebsiteArticle {
  id: string;
  organizationId: string;
  title: string;
  body: string;
  sourcePostId?: string;
  status: ContentStatus;
  createdAt: string;
}

export interface InspirationItem {
  id: string;
  organizationId: string;
  sourceUrl?: string;
  content: string;
  tags: string[];
  note?: string;
  createdAt: string;
}

export interface WatchedInstagramAccount {
  id: string;
  username: string;
  createdAt: string;
}

export interface WatchedYoutubeChannel {
  id: string;
  handle: string;
  displayName?: string | null;
  createdAt: string;
}

// Canonical classification axes - single source of truth shared by the
// backend's classification prompt (lib/contentClassification.ts) and the
// frontend ranking view (ClassificationRanking.tsx). "inne" is a safety
// valve so the model isn't forced into a bad fit.
export const CONTENT_TOPICS = [
  "edukacja",
  "sprzedaż",
  "storytelling/marka osobista",
  "motywacja",
  "oferta/promocja",
  "rozrywka",
  "behind-the-scenes",
  "trend/challenge",
  "inne",
] as const;

export const CONTENT_FORMATS = [
  "storytime",
  "poradnik",
  "ranking/listicle",
  "talking head",
  "Q&A",
  "behind-the-scenes",
  "przed/po",
  "reakcja na trend",
  "inne",
] as const;

export const CONTENT_HOOKS = [
  "pytanie",
  "szokujące twierdzenie",
  "liczba/statystyka",
  "problem na starcie",
  "osobista historia",
  "cliffhanger",
  "inne",
] as const;

// Visual hook - what's SHOWN (not said/written) in the first frame/image,
// classified separately from CONTENT_HOOKS (which fits verbal/textual hooks,
// not raw imagery) - see lib/contentClassification.ts's
// classifyVisualHookFromSource.
export const CONTENT_HOOKS_VISUAL = [
  "zbliżenie na twarz/emocję",
  "nietypowy/zaskakujący kadr",
  "produkt lub jedzenie w centrum kadru",
  "wizualne przed/po",
  "dynamiczny ruch/akcja",
  "tekst/grafika na ekranie jako główny element",
  "perspektywa POV",
  "grupa ludzi/dowód społeczny",
  "inne",
] as const;

// Call-to-action category - see lib/contentClassification.ts's classifyCta,
// always paired with a free-text ctaDetail (the literal CTA wording/
// description) on ScrapedInstagramPost.
export const CONTENT_CTAS = [
  "zachęta do komentarza",
  "zachęta do polubienia/udostępnienia",
  "link w bio / wiadomość prywatna",
  "oznacz znajomego",
  "zapisz post na później",
  "zaproszenie do udziału (wyzwanie/challenge)",
  "brak wyraźnego CTA",
  "inne",
] as const;

export type ContentTopic = (typeof CONTENT_TOPICS)[number];
export type ContentFormat = (typeof CONTENT_FORMATS)[number];
export type ContentHook = (typeof CONTENT_HOOKS)[number];
export type ContentHookVisual = (typeof CONTENT_HOOKS_VISUAL)[number];
export type ContentCta = (typeof CONTENT_CTAS)[number];

// Merged hook taxonomy used by lib/creatorAudit.ts's medium-aware hook
// analysis (hookVideo/hookPost on CreatorAuditPost) - union of CONTENT_HOOKS
// (verbal/narrative) and CONTENT_HOOKS_VISUAL (what's shown), since a single
// Reel's or post's hook can be either kind and forcing a verbal-only or
// visual-only pick loses information. Kept as an explicit list (not derived)
// so the two source lists can keep evolving independently for the legacy
// (global Inspiracje) pipeline, which still uses them separately.
export const CONTENT_HOOKS_UNIFIED = [
  "pytanie",
  "szokujące twierdzenie",
  "liczba/statystyka",
  "problem na starcie",
  "osobista historia",
  "porada/rada",
  "cliffhanger",
  "zbliżenie na twarz/emocję",
  "nietypowy/zaskakujący kadr",
  "produkt lub jedzenie w centrum kadru",
  "wizualne przed/po",
  "dynamiczny ruch/akcja",
  "tekst/grafika na ekranie jako główny element",
  "perspektywa POV",
  "grupa ludzi/dowód społeczny",
  "inne",
] as const;
export type ContentHookUnified = (typeof CONTENT_HOOKS_UNIFIED)[number];

// Where a post's CTA actually appears - "treść główna" (spoken/on-screen, in
// the Reel/image itself) vs "opis" (the caption, a separate thing read
// later) vs "oba" (both) - lets you compare which placement performs better,
// not just whether a CTA exists at all. See lib/contentClassification.ts's
// classifyCtaWithLocation.
export const CONTENT_CTA_LOCATIONS = ["treść główna", "opis", "oba", "brak"] as const;
export type ContentCtaLocation = (typeof CONTENT_CTA_LOCATIONS)[number];

// Admin panel's "Audyt tworcy" tab - one audited Instagram account per
// organization, fully separate from the global Inspiracje watchlist (see
// CreatorAuditAccount/CreatorAuditPost in schema.prisma for why).
export interface CreatorAuditAccount {
  id: string;
  organizationId: string;
  username: string;
  createdAt: string;
  lastScrapedAt: string | null;
}

// The "hooking period" creative-diagnostics signals (see
// lib/mediaAnalysis.ts) - sound events needs actual audio analysis, not a
// frame description, and editing cuts were dropped (unreliable from just 3
// sparse frames sampled across ~2.25s, not a real cut-detection signal).
// facePresence (is a face visible at all) and shotType (how tight the
// framing is) are separate questions - a wide gym shot can have a
// technically-recognizable face without being a close-up.
export type ShotType = "zbliżenie" | "plan średni" | "plan pełny";
export type MotionIntensity = "niska" | "średnia" | "wysoka";

export interface CreatorAuditSlideAnalysis {
  source: string;
  description: string;
  extractedText: string;
  facePresence: boolean;
  shotType: ShotType;
  productPresence: boolean;
  motionIntensity: MotionIntensity;
  brandAssets: boolean;
}

export interface CreatorAuditPost {
  id: string;
  organizationId: string;
  username: string;
  instagramPostId: string;
  url: string;
  type: string;
  caption: string;
  // Every slide's image for an image/carousel post - empty for a video/Reel
  // post (no cover kept for videos, see integrations/instagramScraper.ts).
  imageUrls: string[];
  videoUrl: string | null;
  isReel: boolean;
  likesCount: number;
  commentsCount: number;
  videoViewCount: number | null;
  postedAt: string | null;
  scrapedAt: string;
  transcript: { text: string; segments: { start: number; end: number; text: string }[] } | null;
  // One entry per carousel slide, or one combined entry for a video/Reel's
  // extracted frames - see lib/creatorAudit.ts.
  slideAnalysis: CreatorAuditSlideAnalysis[] | null;
  // Exactly one of hookVideo/hookPost is ever populated per row - which one
  // depends on whether the post has a videoUrl (Reel) or imageUrls (post/
  // carousel). Judged from BOTH what's shown and said/written together (see
  // lib/contentClassification.ts's classifyVideoHook/classifyPostHook), not
  // as two separate text/visual axes - a hook is one thing per post.
  hookVideo: string | null;
  hookVideoDetail: string | null;
  hookPost: string | null;
  hookPostDetail: string | null;
  cta: string | null;
  ctaDetail: string | null;
  ctaLocation: string | null;
  topic: string | null;
  format: string | null;
  // Literal quoted fragment justifying the `format` classification (mirrors
  // ctaDetail) - e.g. the actual "TOP 5 ..." text for a "ranking/listicle"
  // verdict, not a generic caption blurb repeated from elsewhere.
  formatDetail: string | null;
  // Always fetched for every new CreatorAuditPost (unlike the legacy
  // opt-in ScrapedInstagramComment) - see lib/creatorAudit.ts's
  // fetchAndStoreComments.
  comments: CreatorAuditComment[];
}

export interface CreatorAuditComment {
  id: string;
  postId: string;
  author: string;
  authorId: string | null;
  authorVerified: boolean;
  text: string;
  likeCount: number;
  postedAt: string | null;
}

export interface YoutubeVideoSummary {
  id: string;
  channelHandle: string;
  title: string;
  thumbnailUrl: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  durationSec?: number | null;
  publishedAt?: string | null;
  scrapedAt: string;
  // Engagement per day since publishing, normalized against this channel's
  // own median (see lib/engagementNormalization.ts on the backend). Present
  // regardless of sortBy so the UI can show the badge no matter the sort.
  dailyRate?: number;
  outlierRatio?: number | null;
  isMature?: boolean;
  // Set by lib/contentClassification.ts - null until classified.
  topic?: string | null;
  format?: string | null;
  hook?: string | null;
}

export interface YoutubeVideoComment {
  id: string;
  author: string;
  text: string;
  likeCount: number;
  postedAt?: string | null;
}

export interface YoutubeVideoDetail extends YoutubeVideoSummary {
  transcript: string | null;
  comments: YoutubeVideoComment[];
}

export type YoutubeAnalysisAction = "summarize" | "objections" | "topics";

export interface ScrapeProgress {
  isRunning: boolean;
  total: number;
  done: number;
  current: string | null;
}

export interface NewsletterListItem {
  id: string;
  subject: string;
  fromName?: string | null;
  fromAddress?: string | null;
  receivedAt: string;
}

export interface NewsletterDetail extends NewsletterListItem {
  bodyHtml: string | null;
  bodyText: string | null;
}

export interface Conversation {
  id: string;
  organizationId: string;
  socialAccountId: string;
  platform: SocialPlatform;
  participantName: string;
  lastMessageAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  body: string;
  createdAt: string;
}

export interface AnalyticsDailyPoint {
  date: string;
  impressions: number;
  reach: number;
  engagement: number;
  postCount: number;
}

export interface AnalyticsPlatformStats {
  platform: SocialPlatform;
  displayName: string;
  followersCount: number | null;
  postsPerWeek: number;
  avgEngagementRate: number;
  impressions: number;
  reach: number;
}

export interface AnalyticsPostSummary {
  id: string;
  content: string;
  platform: SocialPlatform;
  status: ContentStatus;
  publishedAt?: string;
  scheduledFor?: string;
  platformPostUrl?: string;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  views: number;
  engagementRate: number;
}

export interface AnalyticsSummary {
  // False when ZERNIO_API_KEY isn't set - everything below is empty defaults.
  isConfigured: boolean;
  hasAnalyticsAccess: boolean;
  totalPosts: number;
  publishedPosts: number;
  scheduledPosts: number;
  totals: {
    impressions: number;
    reach: number;
    engagement: number;
  };
  daily: AnalyticsDailyPoint[];
  platforms: AnalyticsPlatformStats[];
  recentPosts: AnalyticsPostSummary[];
}
