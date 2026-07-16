import { useEffect, useState } from "react";
import { apiClient } from "../../lib/apiClient";

interface AccountStats {
  username: string;
  postCount: number;
  lastScrapedAt: string | null;
  lastPostedAt: string | null;
  thumbnailUrl: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "brak";
  return new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
}

// Collapsed by default, same reasoning as WatchlistManager - most visits
// don't need to check scrape coverage, only when the classification ranking
// ("Co działa najlepiej") looks empty and it's not obvious why.
export function AccountStatsPanel() {
  const [accounts, setAccounts] = useState<AccountStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!isExpanded) return;
    setIsLoading(true);
    apiClient
      .get<{ accounts: AccountStats[] }>("/api/inspiration/instagram-account-stats")
      .then((res) => setAccounts(res.accounts))
      .catch(() => setLoadError("Nie udało się pobrać statystyk."))
      .finally(() => setIsLoading(false));
  }, [isExpanded]);

  return (
    <section className="card">
      <button
        type="button"
        className="watchlist-header-toggle"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <h2>Ile treści pobrano z każdego konta</h2>
        <svg
          className={`collapsible-chevron${isExpanded ? " open" : ""}`}
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

      {isExpanded && (
        <div style={{ marginTop: 12 }}>
          {isLoading && <p className="hint-text">Ładowanie…</p>}
          {loadError && <p className="error-text">{loadError}</p>}
          {!isLoading && !loadError && accounts.length === 0 && (
            <p className="hint-text">Brak obserwowanych kont.</p>
          )}
          {!isLoading && !loadError && accounts.length > 0 && (
            <div className="top-metrics-row">
              {accounts.map((account) => (
                <div key={account.username} className="top-metric-card top-metric-card-static">
                  {account.thumbnailUrl && (
                    <img src={account.thumbnailUrl} alt="" className="top-metric-thumb" />
                  )}
                  <p className="top-metric-title">@{account.username}</p>
                  <p className="hint-text">{account.postCount} postów pobranych</p>
                  <p className="hint-text">Ostatni post: {formatDate(account.lastPostedAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
