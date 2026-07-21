// Admin-only "Audyt tworcy" tab - triggers/reads the per-organization
// creator-content-audit pipeline (lib/creatorAudit.ts). See schema.prisma's
// CreatorAuditAccount/CreatorAuditPost comments for why this is fully
// separate from the global Inspiracje watchlist/trends feed.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { requireAdminAuth } from "../middleware/requireAdminAuth";
import { fetchAndAnalyzeCreatorAudit, reanalyzeCreatorAuditPosts } from "../lib/creatorAudit";
import { computeNormalizedScores, MIN_RELIABLE_SAMPLE_SIZE } from "../lib/engagementNormalization";

const router = Router();

router.use(requireAdminAuth);

const fetchSchema = z.object({
  username: z.string().trim().min(1),
  // Capped well below what a single Scrape.do run should ever pull in one
  // click - the client explicitly wants a staged 10 -> 50 -> 200 rollout,
  // not an accidental full-history pull.
  postsCount: z.number().int().min(1).max(300),
});

// Same self-baseline normalization as routes/inspiration.ts's /trends
// endpoint (see lib/engagementNormalization.ts) - "how far does this post
// deviate from THIS creator's own median pace" is exactly as meaningful for
// one audited account as it is for the global watchlist, since it was
// already a per-account (not cross-account) median. getGroupKey is a
// constant here (every row already belongs to the one audited username), not
// because the metric doesn't apply, just because there's only ever one group.
async function loadDump(organizationId: string) {
  const [account, posts] = await Promise.all([
    prisma.creatorAuditAccount.findUnique({ where: { organizationId } }),
    prisma.creatorAuditPost.findMany({
      where: { organizationId },
      orderBy: { postedAt: "desc" },
      include: { comments: { orderBy: { likeCount: "desc" } } },
    }),
  ]);

  const scores = computeNormalizedScores(posts, {
    getEngagement: (p) => p.likesCount + p.commentsCount + (p.videoViewCount ?? 0) / 10,
    getPostedAt: (p) => p.postedAt,
    getGroupKey: () => "self",
  });

  const postsWithScores = posts.map((p) => {
    const score = scores.get(p)!;
    return {
      ...p,
      outlierRatio: score.outlierRatio,
      isMature: score.isMature,
      isRatioReliable: score.isMature && score.sampleSize >= MIN_RELIABLE_SAMPLE_SIZE,
    };
  });

  return { account, posts: postsWithScores };
}

router.get(
  "/:organizationId",
  asyncHandler(async (req, res) => {
    const organization = await prisma.organization.findUnique({ where: { id: req.params.organizationId } });
    if (!organization) {
      throw new HttpError(404, "Nie znaleziono organizacji.");
    }
    res.json(await loadDump(organization.id));
  })
);

router.post(
  "/:organizationId/fetch",
  asyncHandler(async (req, res) => {
    const organization = await prisma.organization.findUnique({ where: { id: req.params.organizationId } });
    if (!organization) {
      throw new HttpError(404, "Nie znaleziono organizacji.");
    }

    const { username, postsCount } = fetchSchema.parse(req.body);
    const result = await fetchAndAnalyzeCreatorAudit(organization.id, username.replace(/^@/, ""), postsCount);
    res.json({ ...result, ...(await loadDump(organization.id)) });
  })
);

// Re-runs the classification pipeline on every post already stored for this
// organization (no scraper call) - for rolling out a prompt/taxonomy change
// (lib/contentClassification.ts) onto posts fetched before the change.
router.post(
  "/:organizationId/reanalyze",
  asyncHandler(async (req, res) => {
    const organization = await prisma.organization.findUnique({ where: { id: req.params.organizationId } });
    if (!organization) {
      throw new HttpError(404, "Nie znaleziono organizacji.");
    }

    const result = await reanalyzeCreatorAuditPosts(organization.id);
    res.json({ ...result, ...(await loadDump(organization.id)) });
  })
);

export default router;
