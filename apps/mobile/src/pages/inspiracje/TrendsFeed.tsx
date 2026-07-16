import { useEffect, useMemo, useRef, useState } from "react";
import type { InspirationItem, ScrapeProgress } from "@mizaly/shared";
import { apiClient, ApiError } from "../../lib/apiClient";
import { ImageLightbox } from "../../components/ImageLightbox";
import { TopMetricsStrip } from "./TopMetricsStrip";
import { SortControl } from "./SortControl";
import { ClassificationRanking } from "./ClassificationRanking";

interface InstagramPost {
  id: string;
  url: string;
  type: string;
  caption: string;
  imageUrl: string;
  videoUrl: string | null;
  isReel: boolean;
  likesCount: number;
  commentsCount: number;
  videoViewCount: number | null;
  username: string;
  timestamp: string;
  // Engagement per day since posting, normalized against this account's own
  // median (see lib/engagementNormalization.ts on the backend).
  dailyRate?: number;
  outlierRatio?: number | null;
  isMature?: boolean;
  // False when the account has too few mature posts for outlierRatio's
  // median to mean anything - see MIN_RELIABLE_SAMPLE_SIZE on the backend.
  isRatioReliable?: boolean;
  accountSampleSize?: number;
  // Set by lib/contentClassification.ts on the backend - null until classified.
  topic?: string | null;
  format?: string | null;
  hook?: string | null;
}

interface TrendsResponse {
  status: "ok" | "pending" | "work_in_progress";
  message?: string;
  posts?: InstagramPost[];
  lastScrapedAt?: string;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} mln`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} tys.`;
  return String(value);
}

function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
}

function formatDateTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pl-PL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const SORT_OPTIONS = [
  { value: "date", label: "Najnowsze" },
  { value: "likes", label: "Najwięcej polubień" },
  { value: "comments", label: "Najwięcej komentarzy" },
  { value: "views", label: "Najwięcej wyświetleń" },
  { value: "normalized", label: "Odchylenie od normy konta" },
];

// Saved-post callback lets the parent page prepend the new item to the
// "Tablica zapisanych inspiracji" list without refetching.
export function TrendsFeed({ onSaved }: { onSaved: (item: InspirationItem) => void }) {
  const [posts, setPosts] = useState<InstagramPost[]>([]);
  const [wipMessage, setWipMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [lightboxPost, setLightboxPost] = useState<InstagramPost | null>(null);
  const [lastScrapedAt, setLastScrapedAt] = useState<string | null>(null);
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("normalized");
  const [scrapeProgress, setScrapeProgress] = useState<ScrapeProgress | null>(null);
  const wasScrapeRunningRef = useRef(false);

  const loadTrends = async (sort: string) => {
    try {
      const res = await apiClient.get<TrendsResponse>(`/api/inspiration/trends?sortBy=${sort}`);
      if (res.status === "ok") {
        setPosts(res.posts ?? []);
        setLastScrapedAt(res.lastScrapedAt ?? null);
      } else {
        setWipMessage(res.message ?? "Ta funkcja jest w budowie.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nie udało się pobrać postów.");
    }
  };

  useEffect(() => {
    setIsLoading(true);
    loadTrends(sortBy).finally(() => setIsLoading(false));
  }, [sortBy]);

  // Polls the scrape status (shared by the manual "Pobierz teraz" click and
  // the hourly background job - see jobs/inspirationScrapeJob.ts) so the
  // "Pobrano X z Y kont" banner reflects a scrape started from either source.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await apiClient.get<ScrapeProgress>("/api/inspiration/scrape-status");
        if (cancelled) return;
        setScrapeProgress(status);
        if (wasScrapeRunningRef.current && !status.isRunning) {
          loadTrends(sortBy);
        }
        wasScrapeRunningRef.current = status.isRunning;
      } catch {
        // non-critical - status polling failure shouldn't block the page
      }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sortBy]);

  // Ranked by outlierRatio (how far a post deviates from its OWN account's
  // usual pace), not raw likes - a plain "most likes" top 3 is dominated by
  // whichever account is biggest/oldest, not by what's actually unusual.
  const topPosts = useMemo(
    () =>
      [...posts]
        .filter((post) => typeof post.outlierRatio === "number" && post.isRatioReliable)
        .sort((a, b) => (b.outlierRatio as number) - (a.outlierRatio as number))
        .slice(0, 3)
        .map((post) => ({
          id: post.id,
          title: post.caption ? post.caption.slice(0, 140) : `@${post.username}`,
          valueLabel: `${(post.outlierRatio as number).toFixed(1)}x normy @${post.username}`,
          thumbnailUrl: post.imageUrl,
          onClick: () => setLightboxPost(post),
        })),
    [posts]
  );

  const handleScrapeNow = async () => {
    setIsScraping(true);
    setScrapeError(null);
    try {
      await apiClient.post("/api/inspiration/scrape-now");
      await loadTrends(sortBy);
    } catch (err) {
      setScrapeError(err instanceof ApiError ? err.message : "Nie udało się pobrać nowych treści.");
    } finally {
      setIsScraping(false);
    }
  };

  const handleSave = async (post: InstagramPost) => {
    setSavingId(post.id);
    try {
      const created = await apiClient.post<InspirationItem>("/api/inspiration-items", {
        sourceUrl: post.url,
        content: post.caption || `Post @${post.username}`,
        tags: ["instagram", post.username],
      });
      setSavedIds((prev) => new Set(prev).add(post.id));
      onSaved(created);
    } catch {
      // non-critical - user can retry
    } finally {
      setSavingId(null);
    }
  };

  return (
    <>
      <ClassificationRanking items={posts} />
      <TopMetricsStrip heading="Top 3 - odchylenie od normy konta" items={topPosts} />

      <section className="card">
        <div className="card-header-row">
          <h2>Trendujące treści</h2>
          <button type="button" className="btn btn-secondary btn-small" disabled={isScraping} onClick={handleScrapeNow}>
            {isScraping ? "Pobieranie…" : "Pobierz teraz"}
          </button>
        </div>
        {scrapeProgress?.isRunning && (
          <p className="hint-text" style={{ marginBottom: 10 }}>
            Pobieranie w tle. Pobrano {scrapeProgress.done} z {scrapeProgress.total} kont
            {scrapeProgress.current ? ` (aktualnie: @${scrapeProgress.current})` : ""}.
          </p>
        )}
        {!scrapeProgress?.isRunning && lastScrapedAt && (
          <p className="hint-text" style={{ marginBottom: 10 }}>
            Ostatnio pobrano: {formatDateTime(lastScrapedAt)}
          </p>
        )}
        {scrapeError && <p className="error-text">{scrapeError}</p>}
        {!wipMessage && <SortControl value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} />}
        {isLoading && <p className="hint-text">Ładowanie…</p>}
        {error && <p className="error-text">{error}</p>}
        {wipMessage && <p className="card-muted-text">{wipMessage}</p>}

      {!isLoading && !error && posts.length > 0 && (
        <div className="insta-feed">
          {posts.map((post) => (
            <article key={post.id} className="insta-post">
              {post.videoUrl ? (
                <div className="insta-post-image">
                  {post.isReel && <span className="insta-post-reel-badge">Reels</span>}
                  <video src={post.videoUrl} poster={post.imageUrl || undefined} controls playsInline preload="metadata" />
                </div>
              ) : (
                post.imageUrl && (
                  <button
                    type="button"
                    className="insta-post-image"
                    onClick={() => setLightboxPost(post)}
                    aria-label="Powiększ zdjęcie"
                  >
                    <img src={post.imageUrl} alt={`Post @${post.username}`} loading="lazy" />
                  </button>
                )
              )}
              <div className="insta-post-body">
                <div className="insta-post-meta">
                  <span className="insta-post-user">@{post.username}</span>
                  <span className="insta-post-date">{formatDate(post.timestamp)}</span>
                </div>
                {post.caption && <p className="insta-post-caption">{post.caption}</p>}
                <div className="insta-post-stats">
                  <span>{formatCount(post.likesCount)} polubień</span>
                  <span>{formatCount(post.commentsCount)} komentarzy</span>
                  {post.videoViewCount != null && post.videoViewCount > 0 && (
                    <span>{formatCount(post.videoViewCount)} wyświetleń</span>
                  )}
                </div>
                {post.isMature === false ? (
                  <span className="outlier-badge outlier-badge--immature">jeszcze rośnie</span>
                ) : post.isRatioReliable && typeof post.outlierRatio === "number" ? (
                  <span className="outlier-badge">{post.outlierRatio.toFixed(1)}x normy konta</span>
                ) : (
                  typeof post.accountSampleSize === "number" && (
                    <span className="outlier-badge outlier-badge--immature">
                      za mało danych tego konta ({post.accountSampleSize}/10 postów)
                    </span>
                  )
                )}
                <div className="insta-post-actions">
                  <a href={post.url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-small">
                    Zobacz na Instagramie
                  </a>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={savingId === post.id || savedIds.has(post.id)}
                    onClick={() => handleSave(post)}
                  >
                    {savedIds.has(post.id) ? "Zapisano" : savingId === post.id ? "Zapisywanie…" : "Zapisz"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {lightboxPost && (
        <ImageLightbox
          src={lightboxPost.imageUrl}
          alt={`Post @${lightboxPost.username}`}
          caption={lightboxPost.caption || undefined}
          onClose={() => setLightboxPost(null)}
        />
      )}
      </section>
    </>
  );
}
