import { useEffect, useState } from "react";
import { apiClient, ApiError } from "../../lib/apiClient";

interface CommentClusterExample {
  text: string;
  postUrl: string;
}

interface CommentCluster {
  label: string;
  count: number;
  exampleComments: CommentClusterExample[];
}

interface CommentClustersResponse {
  clusters: CommentCluster[];
  generatedAt: string | null;
}

type Platform = "instagram" | "youtube";

// Instagram and YouTube routes don't share a path prefix/shape (see
// routes/inspiration.ts vs routes/youtubeVideos.ts), so this is a small
// lookup table rather than a single string template.
const ENDPOINTS_BY_PLATFORM: Record<Platform, { topics: string; questions: string; painPoints: string }> = {
  instagram: {
    topics: "/api/inspiration/instagram-comment-clusters",
    questions: "/api/inspiration/instagram-question-clusters",
    painPoints: "/api/inspiration/instagram-pain-point-clusters",
  },
  youtube: {
    topics: "/api/youtube-videos/comment-clusters",
    questions: "/api/youtube-videos/question-clusters",
    painPoints: "/api/youtube-videos/pain-point-clusters",
  },
};
type ViewMode = keyof (typeof ENDPOINTS_BY_PLATFORM)["instagram"];

const VIEW_LABELS: Record<ViewMode, string> = {
  topics: "Tematy",
  questions: "Pytania widzów",
  painPoints: "Bóle i problemy",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pl-PL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Expanded detail for one cluster - same "accordion row -> detail panel"
// shape as ClassificationRanking's GroupItemCarousel, just a plain quoted
// list instead of a media carousel (there's no photo/video behind a
// comment). exampleComments is already capped server-side
// (MAX_COMMENTS_STORED_PER_CLUSTER) - the note below makes that cap visible
// instead of silently only showing a partial list.
function ClusterDetail({ cluster }: { cluster: CommentCluster }) {
  const hiddenCount = cluster.count - cluster.exampleComments.length;
  return (
    <div className="comment-cluster-list">
      {cluster.exampleComments.map((comment, i) => (
        <p key={i} className="comment-cluster-item">
          „{comment.text}”{" "}
          <a href={comment.postUrl} target="_blank" rel="noreferrer" className="comment-cluster-source-link">
            zobacz źródło →
          </a>
        </p>
      ))}
      {hiddenCount > 0 && (
        <p className="comment-cluster-more hint-text">i jeszcze {hiddenCount} więcej (nie pokazane)</p>
      )}
    </div>
  );
}

// Widzowskie komentarze pogrupowane po temacie (patrz lib/commentClustering.ts
// na backendzie): odfiltrowane z samych reakcji ("🔥", "super!"), zamienione
// na embeddingi i pogrupowane DBSCAN-em po podobieństwie semantycznym - nie
// jeden stos komentarzy wrzucony do GPT, tylko policzalne, posortowane po
// liczności grupy. GPT dotyka tylko gotowych grup, żeby nadać im czytelną
// etykietę i odsiać te, które mimo wszystko są tylko reakcją (odsiane w ogóle
// nie trafiają na listę). Odświeżane po każdym scrapie, tak jak
// ContentIdeasPanel. Ten sam akordeon co ClassificationRanking (stat-row ->
// stat-row-detail) - klik na grupę pokazuje realne komentarze z tej grupy.
export function CommentClusters({ platform }: { platform: Platform }) {
  const [view, setView] = useState<ViewMode>("topics");
  const [clusters, setClusters] = useState<CommentCluster[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [expandedLabel, setExpandedLabel] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    setExpandedLabel(null);
    apiClient
      .get<CommentClustersResponse>(ENDPOINTS_BY_PLATFORM[platform][view])
      .then((res) => {
        setClusters(res.clusters ?? []);
        setGeneratedAt(res.generatedAt ?? null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Nie udało się pobrać segmentacji komentarzy."))
      .finally(() => setIsLoading(false));
  }, [view, platform]);

  return (
    <section className="card">
      <h2>Analiza komentarzy</h2>
      <div className="sub-tabs">
        {(Object.keys(VIEW_LABELS) as ViewMode[]).map((key) => (
          <button
            key={key}
            type="button"
            className={view === key ? "active" : ""}
            onClick={() => setView(key)}
          >
            {VIEW_LABELS[key]}
          </button>
        ))}
      </div>

      {isLoading && <p className="hint-text">Ładowanie…</p>}
      {error && <p className="error-text">{error}</p>}
      {!isLoading && !error && clusters.length === 0 && (
        <p className="card-muted-text">Segmentacja pojawi się po najbliższym przetworzeniu danych.</p>
      )}
      {!isLoading && !error && clusters.length > 0 && (
        <>
          <div className="stat-rows">
            {clusters.map((cluster) => {
              const isOpen = expandedLabel === cluster.label;
              return (
                <div key={cluster.label} className="stat-row-group">
                  <button
                    type="button"
                    className="stat-row stat-row-toggle"
                    aria-expanded={isOpen}
                    onClick={() => setExpandedLabel(isOpen ? null : cluster.label)}
                  >
                    <div className="stat-row-label">{cluster.label}</div>
                    <div className="stat-row-value">
                      {cluster.count}
                      <div className="hint-text">komentarzy</div>
                    </div>
                    <svg
                      className={`collapsible-chevron stat-row-chevron${isOpen ? " open" : ""}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {isOpen && (
                    <div className="stat-row-detail">
                      <ClusterDetail cluster={cluster} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {generatedAt && (
            <p className="hint-text" style={{ marginTop: 10 }}>
              Wygenerowano: {formatDateTime(generatedAt)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
