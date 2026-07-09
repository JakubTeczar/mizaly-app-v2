import { useEffect, useState } from "react";
import type { AnalyticsSummary } from "@mizaly/shared";
import { apiClient, ApiError } from "../lib/apiClient";
import { platformLabel } from "../lib/platformLabels";

const STATUS_LABELS: Record<string, string> = {
  draft: "Szkic",
  scheduled: "Zaplanowany",
  published: "Opublikowany",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const numberFormatter = new Intl.NumberFormat("pl-PL");

function formatNumber(value: number): string {
  return numberFormatter.format(Math.round(value));
}

// Zernio's docs don't confirm the scale of *_engagement_rate fields; treating
// them as a 0-1 fraction (the common convention) rather than already a
// percentage.
function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDayLabel(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${day}.${month}`;
}

export function AnalitykePage() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<AnalyticsSummary>("/api/analytics")
      .then(setSummary)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Nie udało się pobrać analityki."))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div>
      <h1 className="page-title">Analitykę</h1>

      {isLoading && <p className="hint-text">Ładowanie…</p>}
      {error && <p className="error-text">{error}</p>}

      {!isLoading && !error && summary && !summary.isConfigured && (
        <div className="note-banner">
          Analitykę pojawi się po połączeniu kont social media w zakładce Konta.
        </div>
      )}

      {!isLoading && !error && summary && summary.isConfigured && (
        <>
          <div className="metric-grid">
            <div className="metric-card">
              <div className="metric-label">Wyświetlenia</div>
              <div className="metric-value">{formatNumber(summary.totals.impressions)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Zasięg</div>
              <div className="metric-value">{formatNumber(summary.totals.reach)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Zaangażowanie</div>
              <div className="metric-value">{formatNumber(summary.totals.engagement)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Publikacje</div>
              <div className="metric-value">{summary.publishedPosts}</div>
              {summary.scheduledPosts > 0 && (
                <div className="metric-delta">{summary.scheduledPosts} zaplanowanych</div>
              )}
            </div>
          </div>

          {summary.daily.length > 0 && (
            <section className="card">
              <h2>Wyświetlenia dziennie</h2>
              <div className="chart-bars">
                {summary.daily.slice(-14).map((day) => {
                  const max = Math.max(...summary.daily.slice(-14).map((d) => d.impressions), 1);
                  const heightPercent = Math.max((day.impressions / max) * 100, day.impressions > 0 ? 4 : 0);
                  return (
                    <div key={day.date} className="chart-bar-col">
                      <div className="chart-bar-count">{day.impressions > 0 ? formatNumber(day.impressions) : ""}</div>
                      <div className="chart-bar-wrap">
                        <div
                          className={`chart-bar${day.impressions === 0 ? " chart-bar--empty" : ""}`}
                          style={{ height: `${heightPercent}%` }}
                        />
                      </div>
                      <div className="chart-bar-label">{formatDayLabel(day.date)}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {summary.platforms.length > 0 && (
            <section className="card">
              <h2>Konta i platformy</h2>
              <div className="stat-rows">
                {summary.platforms.map((platform) => (
                  <div key={platform.platform} className="stat-row">
                    <div className="stat-row-label">
                      {platformLabel(platform.platform)}
                      <div className="hint-text">
                        {platform.postsPerWeek} postów/tydz., {formatPercent(platform.avgEngagementRate)} zaangażowania
                      </div>
                    </div>
                    <div className="stat-row-value">
                      {platform.followersCount !== null ? formatNumber(platform.followersCount) : "-"}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {summary.recentPosts.length > 0 && (
            <section className="card">
              <h2>Ostatnie posty</h2>
              <div className="list">
                {summary.recentPosts.map((post) => (
                  <div key={post.id} className="list-item">
                    <p style={{ margin: "0 0 6px", fontWeight: 600 }}>{post.content || "Bez treści"}</p>
                    <p className="hint-text" style={{ margin: "0 0 6px" }}>
                      {platformLabel(post.platform)}: {formatNumber(post.impressions)} wyświetleń, zasięg{" "}
                      {formatNumber(post.reach)}, {formatNumber(post.likes)} polubień, {formatNumber(post.comments)}{" "}
                      komentarzy
                    </p>
                    <span className={`status-pill ${post.status}`}>{statusLabel(post.status)}</span>
                    {post.platformPostUrl && (
                      <a
                        href={post.platformPostUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="hint-text"
                        style={{ display: "block", marginTop: 6 }}
                      >
                        Zobacz post
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {summary.totalPosts === 0 && (
            <p className="empty-state">Brak jeszcze opublikowanych postów. Statystyki pojawią się po pierwszej publikacji.</p>
          )}
        </>
      )}
    </div>
  );
}
