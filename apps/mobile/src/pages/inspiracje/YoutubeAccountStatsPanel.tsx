import { useEffect, useState } from "react";
import { apiClient } from "../../lib/apiClient";

interface ChannelStats {
  handle: string;
  displayName: string | null;
  videoCount: number;
  lastScrapedAt: string | null;
  lastPublishedAt: string | null;
  thumbnailUrl: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "brak";
  return new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
}

// YouTube sibling of AccountStatsPanel.tsx (Instagram) - same collapsed-by-
// default reasoning: most visits don't need to check scrape coverage, only
// when the classification ranking looks empty and it's not obvious why.
export function YoutubeAccountStatsPanel() {
  const [channels, setChannels] = useState<ChannelStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!isExpanded) return;
    setIsLoading(true);
    apiClient
      .get<{ channels: ChannelStats[] }>("/api/youtube-videos/channel-stats")
      .then((res) => setChannels(res.channels))
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
        <h2>Ile treści pobrano z każdego kanału</h2>
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
          {!isLoading && !loadError && channels.length === 0 && (
            <p className="hint-text">Brak obserwowanych kanałów.</p>
          )}
          {!isLoading && !loadError && channels.length > 0 && (
            <div className="top-metrics-row">
              {channels.map((channel) => (
                <div key={channel.handle} className="top-metric-card top-metric-card-static">
                  {channel.thumbnailUrl && (
                    <img src={channel.thumbnailUrl} alt="" className="top-metric-thumb" />
                  )}
                  <p className="top-metric-title">{channel.displayName ? channel.displayName : `@${channel.handle}`}</p>
                  <p className="hint-text">{channel.videoCount} filmów pobranych</p>
                  <p className="hint-text">Ostatni film: {formatDate(channel.lastPublishedAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
