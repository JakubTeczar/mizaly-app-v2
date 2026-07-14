import { useEffect, useState } from "react";
import type { NewsletterDetail, NewsletterListItem } from "@mizaly/shared";
import { apiClient, ApiError } from "../../lib/apiClient";
import { AiInsightCard } from "./AiInsightCard";
import { SortControl } from "./SortControl";

const SORT_OPTIONS = [
  { value: "newest", label: "Najnowsze" },
  { value: "oldest", label: "Najstarsze" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" });
}

function NewsletterDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const [newsletter, setNewsletter] = useState<NewsletterDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<NewsletterDetail>(`/api/newsletters/${id}`)
      .then(setNewsletter)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Nie udało się pobrać newslettera."));
  }, [id]);

  return (
    <div>
      <div className="favorites-header">
        <button type="button" className="btn btn-secondary btn-small" onClick={onBack}>
          ← Wróć
        </button>
        <h2 className="favorites-title">{newsletter?.subject ?? "Newsletter"}</h2>
      </div>

      {error && <p className="error-text">{error}</p>}
      {!newsletter && !error && <p className="hint-text">Ładowanie…</p>}

      {newsletter && (
        <section className="card">
          <p className="hint-text" style={{ marginBottom: 12 }}>
            {(newsletter.fromName || newsletter.fromAddress) ?? "Nieznany nadawca"} · {formatDate(newsletter.receivedAt)}
          </p>
          {newsletter.bodyHtml ? (
            <div className="newsletter-body" dangerouslySetInnerHTML={{ __html: newsletter.bodyHtml }} />
          ) : (
            <p className="newsletter-body" style={{ whiteSpace: "pre-wrap" }}>
              {newsletter.bodyText ?? "Brak treści."}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

export function NewsletterSection() {
  const [newsletters, setNewsletters] = useState<NewsletterListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("newest");

  useEffect(() => {
    setIsLoading(true);
    apiClient
      .get<NewsletterListItem[]>(`/api/newsletters?sortBy=${sortBy}`)
      .then(setNewsletters)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Nie udało się pobrać newsletterów."))
      .finally(() => setIsLoading(false));
  }, [sortBy]);

  if (selectedId) {
    return <NewsletterDetailView id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <>
      <AiInsightCard endpoint="/api/newsletters/insights" />
      <section className="card">
        <h2>Newslettery</h2>
        <SortControl value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} />
        {isLoading && <p className="hint-text">Ładowanie…</p>}
        {loadError && <p className="error-text">{loadError}</p>}
        {!isLoading && !loadError && newsletters.length === 0 && (
          <p className="card-muted-text">Newslettery pojawią się tu po pierwszym sprawdzeniu skrzynki.</p>
        )}

        <div className="list">
          {newsletters.map((item) => (
            <button
              key={item.id}
              type="button"
              className="list-item newsletter-list-item"
              onClick={() => setSelectedId(item.id)}
            >
              <p style={{ margin: "0 0 6px", fontWeight: 700 }}>{item.subject}</p>
              <p className="hint-text" style={{ margin: 0 }}>
                {(item.fromName || item.fromAddress) ?? "Nieznany nadawca"} · {formatDate(item.receivedAt)}
              </p>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
