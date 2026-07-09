import { useEffect, useState } from "react";
import type { InspirationItem } from "@mizaly/shared";
import { apiClient, ApiError } from "../../lib/apiClient";
import { ImageLightbox } from "../../components/ImageLightbox";

interface InstagramPost {
  id: string;
  url: string;
  type: string;
  caption: string;
  imageUrl: string;
  likesCount: number;
  commentsCount: number;
  videoViewCount: number | null;
  username: string;
  timestamp: string;
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

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<TrendsResponse>("/api/inspiration/trends")
      .then((res) => {
        if (cancelled) return;
        if (res.status === "ok") {
          setPosts(res.posts ?? []);
        } else {
          setWipMessage(res.message ?? "Ta funkcja jest w budowie.");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Nie udało się pobrać postów.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    <section className="card">
      <h2>Trendujące treści</h2>
      {isLoading && <p className="hint-text">Ładowanie…</p>}
      {error && <p className="error-text">{error}</p>}
      {wipMessage && <p className="card-muted-text">{wipMessage}</p>}

      {!isLoading && !error && posts.length > 0 && (
        <div className="insta-feed">
          {posts.map((post) => (
            <article key={post.id} className="insta-post">
              {post.imageUrl && (
                <button
                  type="button"
                  className="insta-post-image"
                  onClick={() => setLightboxPost(post)}
                  aria-label="Powiększ zdjęcie"
                >
                  <img src={post.imageUrl} alt={`Post @${post.username}`} loading="lazy" />
                </button>
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
          onClose={() => setLightboxPost(null)}
        />
      )}
    </section>
  );
}

interface AnalysisResponse {
  status: "ok" | "pending";
  message?: string;
  content?: string;
  createdAt?: string;
}

// AI write-up of the scraped posts' engagement, regenerated after every
// scrape-job run (see backend src/jobs/inspirationScrapeJob.ts).
export function AnalysisCard() {
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<AnalysisResponse>("/api/inspiration/analysis")
      .then((res) => {
        if (!cancelled) setAnalysis(res);
      })
      .catch(() => {
        if (!cancelled) setError("Nie udało się pobrać analizy.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="card">
      <h2>Analiza AI</h2>
      {error && <p className="error-text">{error}</p>}
      {!analysis && !error && <p className="hint-text">Ładowanie…</p>}
      {analysis?.status === "pending" && <p className="card-muted-text">{analysis.message}</p>}
      {analysis?.status === "ok" && (
        <>
          <p className="analysis-text">{analysis.content}</p>
          {analysis.createdAt && (
            <p className="hint-text" style={{ marginTop: 8 }}>
              Wygenerowano: {new Date(analysis.createdAt).toLocaleString("pl-PL")}
            </p>
          )}
        </>
      )}
    </section>
  );
}
