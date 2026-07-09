// Wspólne typy i enumy używane przez backend, mobile i admin.
// Powinny odzwierciedlać model danych z ROADMAP.md — przy zmianie schematu Prisma, zaktualizuj też ten plik.

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

export interface Post {
  id: string;
  organizationId: string;
  heading: string;
  content: string;
  firstComment?: string;
  mediaUrls: string[];
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
