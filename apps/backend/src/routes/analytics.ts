import { Router } from "express";
import type { AnalyticsSummary } from "@mizaly/shared";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import * as zernio from "../integrations/zernio";
import { ensureZernioProfileId } from "../integrations/zernioProfile";
import { resolveZernioApiKey } from "../integrations/zernioApiKeys";

const router = Router();

const EMPTY_SUMMARY: AnalyticsSummary = {
  isConfigured: false,
  hasAnalyticsAccess: false,
  totalPosts: 0,
  publishedPosts: 0,
  scheduledPosts: 0,
  totals: { impressions: 0, reach: 0, engagement: 0 },
  daily: [],
  platforms: [],
  recentPosts: [],
};

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const apiKey = resolveZernioApiKey(req.user!.zernioApiKeyId);
    if (!apiKey) {
      return res.json(EMPTY_SUMMARY);
    }

    const organizationId = req.user!.organizationId;
    const profileId = await ensureZernioProfileId(organizationId, apiKey);

    const [overview, dailyMetrics] = await Promise.all([
      zernio.getAnalyticsOverview(apiKey, profileId),
      zernio.getDailyMetrics(apiKey, profileId),
    ]);

    // Posting frequency is per-account (not per-profile), so fetch it for
    // each connected account individually and tolerate per-account failures
    // rather than losing the whole page over one flaky account.
    const frequencyByAccountId = new Map<string, ZernioFrequencyEntry[]>();
    await Promise.all(
      overview.accounts.map(async (account) => {
        try {
          const { frequency } = await zernio.getPostingFrequency(apiKey, account._id);
          frequencyByAccountId.set(account._id, frequency);
        } catch (err) {
          console.error(`Zernio posting-frequency failed for account ${account._id}:`, err);
          frequencyByAccountId.set(account._id, []);
        }
      })
    );

    const platforms: AnalyticsSummary["platforms"] = overview.accounts.map((account) => {
      const frequency = frequencyByAccountId.get(account._id) ?? [];
      const platformFrequency = frequency.find((entry) => entry.platform === account.platform);
      const breakdown = dailyMetrics.platformBreakdown.find((entry) => entry.platform === account.platform);
      return {
        platform: account.platform as AnalyticsSummary["platforms"][number]["platform"],
        displayName: account.displayName || account.username || account.platform,
        followersCount: account.followersCount ?? null,
        postsPerWeek: platformFrequency?.posts_per_week ?? 0,
        avgEngagementRate: platformFrequency?.avg_engagement_rate ?? 0,
        impressions: breakdown?.impressions ?? 0,
        reach: breakdown?.reach ?? 0,
      };
    });

    const daily: AnalyticsSummary["daily"] = dailyMetrics.dailyData.map((day) => ({
      date: day.date,
      impressions: day.metrics.impressions,
      reach: day.metrics.reach,
      engagement: day.metrics.likes + day.metrics.comments + day.metrics.shares + day.metrics.saves,
      postCount: day.postCount,
    }));

    const totals = daily.reduce(
      (acc, day) => ({
        impressions: acc.impressions + day.impressions,
        reach: acc.reach + day.reach,
        engagement: acc.engagement + day.engagement,
      }),
      { impressions: 0, reach: 0, engagement: 0 }
    );

    const recentPosts: AnalyticsSummary["recentPosts"] = overview.posts
      .slice()
      .sort((a, b) => postTimestamp(b) - postTimestamp(a))
      .slice(0, 10)
      .map((post) => ({
        id: post._id,
        content: post.content ?? "",
        platform: (post.platform ?? "instagram") as AnalyticsSummary["recentPosts"][number]["platform"],
        status: post.status as AnalyticsSummary["recentPosts"][number]["status"],
        publishedAt: post.publishedAt,
        scheduledFor: post.scheduledFor,
        platformPostUrl: post.platformPostUrl,
        impressions: post.analytics?.impressions ?? 0,
        reach: post.analytics?.reach ?? 0,
        likes: post.analytics?.likes ?? 0,
        comments: post.analytics?.comments ?? 0,
        shares: post.analytics?.shares ?? 0,
        saves: post.analytics?.saves ?? 0,
        clicks: post.analytics?.clicks ?? 0,
        views: post.analytics?.views ?? 0,
        engagementRate: post.analytics?.engagementRate ?? 0,
      }));

    const summary: AnalyticsSummary = {
      isConfigured: true,
      hasAnalyticsAccess: overview.hasAnalyticsAccess ?? true,
      totalPosts: overview.overview.totalPosts,
      publishedPosts: overview.overview.publishedPosts,
      scheduledPosts: overview.overview.scheduledPosts,
      totals,
      daily,
      platforms,
      recentPosts,
    };

    res.json(summary);
  })
);

type ZernioFrequencyEntry = zernio.ZernioPostingFrequencyResponse["frequency"][number];

function postTimestamp(post: zernio.ZernioAnalyticsPost): number {
  const value = post.publishedAt || post.scheduledFor;
  return value ? new Date(value).getTime() : 0;
}

export default router;
