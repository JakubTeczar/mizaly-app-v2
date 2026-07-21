import { useEffect, useState } from "react";
import { apiClient, ApiError } from "../../lib/apiClient";

interface ContentIdea {
  title: string;
  rationale: string;
}

interface ContentIdeasResponse {
  ideas: ContentIdea[];
  generatedAt: string | null;
}

const ENDPOINTS = {
  instagram: "/api/inspiration/instagram-content-ideas",
  youtube: "/api/youtube-videos/content-ideas",
} as const;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pl-PL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Turns the classification-group rankings shown in ClassificationRanking
// (and the outlier posts in TopMetricsStrip) into concrete, ready-to-record
// ideas for the client - see lib/contentIdeas.ts on the backend, which
// generates and caches these at the end of each scrape job run. Fetches on
// mount (unlike AccountStatsPanel's lazy-on-expand) since this is meant to be
// the primary actionable takeaway of the section, not secondary info to dig
// into on demand.
export function ContentIdeasPanel({ source }: { source: "instagram" | "youtube" }) {
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    apiClient
      .get<ContentIdeasResponse>(ENDPOINTS[source])
      .then((res) => {
        setIdeas(res.ideas ?? []);
        setGeneratedAt(res.generatedAt ?? null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Nie udało się pobrać pomysłów."))
      .finally(() => setIsLoading(false));
  }, [source]);

  return (
    <section className="card">
      <h2>Pomysły na content</h2>
      {isLoading && <p className="hint-text">Ładowanie…</p>}
      {error && <p className="error-text">{error}</p>}
      {!isLoading && !error && ideas.length === 0 && (
        <p className="card-muted-text">Pomysły pojawią się po najbliższym przetworzeniu danych.</p>
      )}
      {!isLoading && !error && ideas.length > 0 && (
        <>
          <div className="stat-rows">
            {ideas.map((idea, index) => (
              <div key={index} className="stat-row">
                <div className="stat-row-label">
                  {idea.title}
                  <div className="hint-text">{idea.rationale}</div>
                </div>
              </div>
            ))}
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
