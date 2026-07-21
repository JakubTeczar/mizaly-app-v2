// Admin-only "Audyt tworcy" tab: pick an organization, point it at ONE real
// Instagram creator account, fetch a handful of their own posts, and dump
// every field the classification pipeline produces (hookVideo/hookPost/cta/
// topic/format/transcript/visual description) - a systematic look at the raw
// data before deciding whether to scale a fetch up (10 -> 50 -> 200 posts).
//
// Deliberately separate from the Inspiracje watchlist (see
// CreatorAuditAccount/CreatorAuditPost in schema.prisma) - this is one
// organization's OWN content, not a shared cross-account trends feed.
//
// Two columns: left is the raw per-post dump (every signal, every field),
// right is the same "co działa najlepiej" classification ranking the mobile
// app's Inspiracje tab shows (topic/format/hookVideo/hookPost/cta grouped by
// self-baseline outlierRatio, see lib/engagementNormalization.ts) - side by
// side so it's obvious which raw data produced which conclusion, and why.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { CreatorAuditAccount, CreatorAuditPost, Organization, User } from "@mizaly/shared";
import { apiClient, ApiError } from "../lib/apiClient";

type OrganizationWithUsers = Organization & { users: User[] };

// Extends the stored shape with the same computed self-baseline fields
// routes/inspiration.ts's /trends endpoint attaches - computed fresh per
// request server-side, never persisted (see routes/adminCreatorAudit.ts).
type ScoredPost = CreatorAuditPost & {
  outlierRatio: number | null;
  isMature: boolean;
  isRatioReliable: boolean;
};

interface DumpResponse {
  account: CreatorAuditAccount | null;
  posts: ScoredPost[];
}

interface FetchResponse extends DumpResponse {
  fetched: number;
  newPosts: number;
}

interface ReanalyzeResponse extends DumpResponse {
  reanalyzed: number;
}

// hookVideo is only ever set on Reel/video posts, hookPost only on image/
// carousel posts - each axis naturally only groups the subset of posts it
// applies to (rankBy already skips a null value for any post).
const RANKING_AXES = ["topic", "format", "hookVideo", "hookPost", "cta"] as const;
type RankingAxis = (typeof RANKING_AXES)[number];

const AXIS_LABELS: Record<RankingAxis, string> = {
  topic: "Temat",
  format: "Format",
  hookVideo: "Hook (Reels)",
  hookPost: "Hook (post)",
  cta: "CTA",
};

// Same threshold as apps/mobile/src/pages/inspiracje/ClassificationRanking.tsx
// - a single post trivially "beats the norm" or not, that's not a pattern.
const MIN_GROUP_SIZE = 2;
// Mirrors MIN_RELIABLE_SAMPLE_SIZE in lib/engagementNormalization.ts (backend-
// only module, can't import it directly from here) - purely informational
// text, the actual gating already happened server-side via isRatioReliable.
const MIN_RELIABLE_HINT_THRESHOLD = 10;

interface RankedGroup {
  label: string;
  avgRatio: number;
  count: number;
  posts: ScoredPost[];
}

function rankBy(posts: ScoredPost[], axis: RankingAxis): RankedGroup[] {
  const byLabel = new Map<string, ScoredPost[]>();
  for (const post of posts) {
    const label = post[axis];
    if (!label || label === "inne") continue;
    if (!post.isRatioReliable || typeof post.outlierRatio !== "number") continue;
    const list = byLabel.get(label) ?? [];
    list.push(post);
    byLabel.set(label, list);
  }

  return Array.from(byLabel.entries())
    .map(([label, groupPosts]) => ({
      label,
      avgRatio: groupPosts.reduce((sum, p) => sum + (p.outlierRatio ?? 0), 0) / groupPosts.length,
      count: groupPosts.length,
      posts: [...groupPosts].sort((a, b) => (b.outlierRatio ?? 0) - (a.outlierRatio ?? 0)),
    }))
    .filter((group) => group.count >= MIN_GROUP_SIZE)
    .sort((a, b) => b.avgRatio - a.avgRatio);
}

function scrollToPost(postId: string) {
  document.getElementById(`audit-post-${postId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// The literal fragment that actually justifies THIS axis's classification
// (formatDetail/hookVideoDetail/hookPostDetail/ctaDetail) - falls back to the
// caption only for "topic" (no dedicated detail field for that axis) or when
// the detail wasn't populated (e.g. rows analyzed before it existed).
function detailFor(post: ScoredPost, axis: RankingAxis): string {
  switch (axis) {
    case "format":
      return post.formatDetail || post.caption;
    case "hookVideo":
      return post.hookVideoDetail || post.caption;
    case "hookPost":
      return post.hookPostDetail || post.caption;
    case "cta":
      return post.ctaDetail || post.caption;
    case "topic":
      return post.caption;
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pl-PL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="audit-field">
      <div className="audit-field__label">{label}</div>
      <div className="audit-field__value">{value}</div>
    </div>
  );
}

// Right column: identical grouping/ranking logic to the mobile app's
// ClassificationRanking, just reading ScoredPost instead of ClassifiableItem -
// lets you see exactly which posts (and thus which raw signals) fed each
// "this works well" conclusion, with a jump-to-post link into the left dump.
function ClassificationPanel({ posts }: { posts: ScoredPost[] }) {
  const [axis, setAxis] = useState<RankingAxis>("topic");
  const groups = useMemo(() => rankBy(posts, axis), [posts, axis]);
  const reliableCount = posts.filter((p) => p.isRatioReliable).length;

  return (
    <div className="audit-controls audit-ranking-panel">
      <h2 style={{ marginTop: 0 }}>Co działa najlepiej</h2>
      <p className="form-hint" style={{ marginTop: -4 }}>
        Grupuje posty po osi klasyfikacji i sortuje po odchyleniu od własnej mediany konta (outlierRatio) -
        dokładnie ten sam mechanizm co "Co działa najlepiej" w Inspiracjach mobile.
      </p>

      <div className="sub-tabs" style={{ margin: "10px 0 16px" }}>
        {RANKING_AXES.map((key) => (
          <button
            key={key}
            type="button"
            className={axis === key ? "" : "secondary"}
            onClick={() => setAxis(key)}
          >
            {AXIS_LABELS[key]}
          </button>
        ))}
      </div>

      {reliableCount < MIN_RELIABLE_HINT_THRESHOLD && (
        <p className="notice" style={{ marginBottom: 12 }}>
          Tylko {reliableCount} post(y) mają wystarczająco dużo danych (próg: {MIN_RELIABLE_HINT_THRESHOLD}), żeby
          outlierRatio było wiarygodne - ranking będzie się wypełniał w miarę kolejnych pobrań.
        </p>
      )}

      {groups.length === 0 ? (
        <p className="notice">
          Jeszcze za mało sklasyfikowanych i dojrzałych postów w tej samej grupie (min. {MIN_GROUP_SIZE}), żeby to
          policzyć.
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.label} style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <strong>{group.label}</strong>
              <span className="notice">
                {group.avgRatio.toFixed(1)}x normy · {group.count} post(y)
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
              {group.posts.map((post) => {
                const detail = detailFor(post, axis);
                return (
                  <button
                    key={post.id}
                    type="button"
                    className="secondary"
                    style={{ textAlign: "left", width: "100%" }}
                    onClick={() => scrollToPost(post.id)}
                  >
                    {(post.outlierRatio ?? 0).toFixed(1)}x - {detail ? detail.slice(0, 70) : post.instagramPostId}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function CreatorAuditPage() {
  const [organizations, setOrganizations] = useState<OrganizationWithUsers[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(true);

  const [account, setAccount] = useState<CreatorAuditAccount | null>(null);
  const [posts, setPosts] = useState<ScoredPost[]>([]);
  const [isLoadingDump, setIsLoadingDump] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [postsCount, setPostsCount] = useState(10);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<OrganizationWithUsers[]>("/api/admin/organizations")
      .then((orgs) => {
        setOrganizations(orgs);
        // "Demo Organization" is the stand-in test account for this feature
        // (see docs/Backlog.md) until a real client is wired up - preselect
        // it if present so the common case needs zero clicks.
        const demo = orgs.find((o) => o.name === "Demo Organization");
        setOrganizationId(demo?.id ?? orgs[0]?.id ?? "");
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Nie udało się pobrać organizacji."))
      .finally(() => setIsLoadingOrgs(false));
  }, []);

  const loadDump = async (orgId: string) => {
    setIsLoadingDump(true);
    setLoadError(null);
    try {
      const dump = await apiClient.get<DumpResponse>(`/api/admin/creator-audit/${orgId}`);
      setAccount(dump.account);
      setPosts(dump.posts);
      setUsername(dump.account?.username ?? "");
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Nie udało się pobrać danych audytu.");
    } finally {
      setIsLoadingDump(false);
    }
  };

  useEffect(() => {
    if (organizationId) loadDump(organizationId);
  }, [organizationId]);

  const handleFetch = async (event: FormEvent) => {
    event.preventDefault();
    if (!organizationId || !username.trim()) return;
    setIsFetching(true);
    setFetchError(null);
    setResultMessage(null);
    try {
      const result = await apiClient.post<FetchResponse>(`/api/admin/creator-audit/${organizationId}/fetch`, {
        username: username.trim(),
        postsCount,
      });
      setAccount(result.account);
      setPosts(result.posts);
      setResultMessage(
        `Scraper zwrócił ${result.fetched} postów, z czego ${result.newPosts} było nowych i zostało przeanalizowanych ` +
          `(reszta już była w bazie z wcześniejszego pobrania - pominięta).`
      );
    } catch (err) {
      setFetchError(err instanceof ApiError ? err.message : "Nie udało się pobrać/przeanalizować postów.");
    } finally {
      setIsFetching(false);
    }
  };

  const handleReanalyze = async () => {
    if (!organizationId) return;
    setIsReanalyzing(true);
    setReanalyzeError(null);
    setResultMessage(null);
    try {
      const result = await apiClient.post<ReanalyzeResponse>(`/api/admin/creator-audit/${organizationId}/reanalyze`, {});
      setAccount(result.account);
      setPosts(result.posts);
      setResultMessage(`Ponownie przeanalizowano ${result.reanalyzed} post(y) (bez ponownego pobierania).`);
    } catch (err) {
      setReanalyzeError(err instanceof ApiError ? err.message : "Nie udało się ponownie przeanalizować postów.");
    } finally {
      setIsReanalyzing(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Audyt tworcy</h1>
          <p className="page-subtitle">
            Pobiera posty jednego, realnego konta na Instagramie i pokazuje pełny dump tego, co pipeline
            klasyfikacji o nich wie (hook, CTA, temat, format). Osobne od współdzielonego feedu Inspiracji - to
            konto nie pojawi się jako inspiracja u innych organizacji.
          </p>
        </div>
      </div>

      {loadError && <div className="form-error">{loadError}</div>}

      <div className="audit-controls">
        <label htmlFor="auditOrg">Organizacja</label>
        <select
          id="auditOrg"
          value={organizationId}
          onChange={(e) => setOrganizationId(e.target.value)}
          disabled={isLoadingOrgs}
        >
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>

        <form onSubmit={handleFetch}>
          <label htmlFor="auditUsername">Instagram - nazwa konta (bez @)</label>
          <input
            id="auditUsername"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="np. trener_z_polnocy"
            required
          />

          <label htmlFor="auditCount">Liczba postów do pobrania</label>
          <input
            id="auditCount"
            type="number"
            min={1}
            max={300}
            value={postsCount}
            onChange={(e) => setPostsCount(Number(e.target.value) || 1)}
          />
          <p className="form-hint">
            Kolejne pobranie z większą liczbą (np. 50, potem 200) nie powtórzy już przeanalizowanych postów -
            dotyczy tylko nowo odkrytych.
          </p>

          {fetchError && <div className="form-error">{fetchError}</div>}
          {resultMessage && <div className="form-success">{resultMessage}</div>}

          <button type="submit" disabled={isFetching || !organizationId}>
            {isFetching ? "Pobieranie i analiza…" : "Pobierz"}
          </button>
        </form>

        {account && (
          <p className="notice">
            Aktualnie audytowane konto: @{account.username} - ostatnio pobrano: {formatDateTime(account.lastScrapedAt)}.
          </p>
        )}

        {posts.length > 0 && (
          <>
            <button
              type="button"
              className="secondary"
              disabled={isReanalyzing || !organizationId}
              onClick={handleReanalyze}
            >
              {isReanalyzing ? "Ponowna analiza…" : `Przeanalizuj ponownie (${posts.length} postów, bez pobierania)`}
            </button>
            <p className="form-hint" style={{ marginTop: 4 }}>
              Przepuszcza już pobrane posty przez aktualny pipeline klasyfikacji (np. po zmianie promptów) - nie
              pobiera nic nowego od scrapera.
            </p>
            {reanalyzeError && <div className="form-error">{reanalyzeError}</div>}
          </>
        )}
      </div>

      {isLoadingDump && <p className="notice">Ładowanie…</p>}
      {!isLoadingDump && posts.length === 0 && <p className="notice">Brak pobranych postów dla tej organizacji.</p>}

      {posts.length > 0 && (
        <div className="audit-layout">
          <div className="audit-layout__left">
            <h2>Dump ({posts.length} postów w bazie)</h2>
            <div className="audit-post-list">
              {posts.map((post) => (
                <div key={post.id} id={`audit-post-${post.id}`} className="audit-post-card">
                  <div className="audit-post-card__media">
                    {post.videoUrl ? (
                      <video src={post.videoUrl} controls preload="metadata" />
                    ) : post.imageUrls.length > 0 ? (
                      <div className="audit-post-card__gallery">
                        {post.imageUrls.map((url, i) => (
                          <img key={i} src={url} alt="" loading="lazy" />
                        ))}
                      </div>
                    ) : (
                      <div className="audit-post-card__media-empty" />
                    )}
                  </div>
                  <div className="audit-post-card__fields">
                    <div className="audit-badge-row">
                      <span className="badge badge--neutral">
                        {post.isReel ? "Reels" : post.videoUrl ? "Wideo" : post.imageUrls.length > 1 ? `Karuzela (${post.imageUrls.length})` : "Zdjęcie"}
                      </span>
                      {post.topic && <span className="badge badge--neutral">{post.topic}</span>}
                      {post.format && <span className="badge badge--neutral">{post.format}</span>}
                      {post.isRatioReliable && typeof post.outlierRatio === "number" && (
                        <span className="badge badge--ok">{post.outlierRatio.toFixed(1)}x normy konta</span>
                      )}
                    </div>

                    <Field
                      label="URL"
                      value={
                        <a href={post.url} target="_blank" rel="noreferrer">
                          {post.url}
                        </a>
                      }
                    />
                    <Field label="Data publikacji" value={formatDateTime(post.postedAt)} />
                    <Field
                      label="Statystyki"
                      value={`${post.likesCount} polubień, ${post.commentsCount} komentarzy${post.videoViewCount != null ? `, ${post.videoViewCount} wyświetleń` : ""}`}
                    />
                    <Field label="Podpis (caption)" value={post.caption} />
                    <Field label="Format - fragment" value={post.formatDetail} />
                    <Field label="Hook (Reels)" value={post.hookVideo} />
                    <Field label="Hook (Reels) - konkretne zdanie" value={post.hookVideoDetail} />
                    <Field label="Hook (post)" value={post.hookPost} />
                    <Field label="Hook (post) - konkretne zdanie" value={post.hookPostDetail} />
                    <Field label="CTA" value={post.cta} />
                    <Field label="CTA - szczegół" value={post.ctaDetail} />
                    <Field label="CTA - lokalizacja" value={post.ctaLocation} />
                    <Field
                      label={`Transkrypt (pierwsze okno hooka)`}
                      value={post.transcript?.text?.slice(0, 500) ?? null}
                    />

                    {post.slideAnalysis && post.slideAnalysis.length > 0 && (
                      <div className="audit-field">
                        <div className="audit-field__label">Analiza wizualna (AI vision) per slajd/klatki</div>
                        {post.slideAnalysis.map((slide, i) => (
                          <div key={i} className="audit-slide-analysis">
                            <strong>{slide.source}</strong>
                            <div>{slide.description}</div>
                            {slide.extractedText && <div className="audit-slide-analysis__text">Tekst na obrazie: {slide.extractedText}</div>}
                            <div className="audit-badge-row" style={{ marginTop: 6, marginBottom: 0 }}>
                              <span className="badge badge--neutral">{slide.shotType}</span>
                              {slide.facePresence && <span className="badge badge--neutral">Twarz widoczna</span>}
                              <span className="badge badge--neutral">Ruch: {slide.motionIntensity}</span>
                              {slide.productPresence && <span className="badge badge--neutral">Produkt/sprzęt w kadrze</span>}
                              {slide.brandAssets && <span className="badge badge--neutral">Logo/branding</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {post.comments.length > 0 && (
                      <div className="audit-field">
                        <div className="audit-field__label">
                          Komentarze ({post.comments.length}, top 5 wg polubień)
                        </div>
                        {post.comments.slice(0, 5).map((comment) => (
                          <div key={comment.id} className="audit-slide-analysis">
                            <strong>@{comment.author}</strong> ({comment.likeCount} polubień)
                            <div>{comment.text}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="audit-layout__right">
            <ClassificationPanel posts={posts} />
          </div>
        </div>
      )}
    </div>
  );
}
