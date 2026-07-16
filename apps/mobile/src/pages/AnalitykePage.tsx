import { useEffect, useState } from "react";
import type { AnalyticsSummary } from "@mizaly/shared";
import { apiClient, ApiError } from "../lib/apiClient";
import { platformLabel } from "../lib/platformLabels";
import { FEATURE_FLAGS } from "../lib/featureFlags";
import { AnalyticsLineChart } from "../components/AnalyticsLineChart";

type ChartRange = "week" | "month" | "quarter";

const RANGE_DAYS: Record<ChartRange, number> = { week: 7, month: 30, quarter: 90 };
const RANGE_LABELS: Record<ChartRange, string> = { week: "Tydzień", month: "Miesiąc", quarter: "Kwartał" };

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
  const [chartRange, setChartRange] = useState<ChartRange>("week");
  const [isPlatformsOpen, setIsPlatformsOpen] = useState(false);

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

          {summary.daily.length > 1 && (
            <section className="card">
              <h2>Wyświetlenia</h2>
              <div className="sub-tabs">
                {(Object.keys(RANGE_LABELS) as ChartRange[]).map((range) => (
                  <button
                    key={range}
                    type="button"
                    className={chartRange === range ? "active" : ""}
                    onClick={() => setChartRange(range)}
                  >
                    {RANGE_LABELS[range]}
                  </button>
                ))}
              </div>
              <AnalyticsLineChart
                key={chartRange}
                points={summary.daily.slice(-RANGE_DAYS[chartRange]).map((day) => ({
                  date: day.date,
                  value: day.impressions,
                }))}
                formatValue={formatNumber}
                formatDate={formatDayLabel}
              />
            </section>
          )}

          {summary.recentPosts.length > 0 && FEATURE_FLAGS.analitykaOstatniePosty && (
            <section className="card">
              <div className="card-header-row">
                <h2>Ostatnie posty</h2>
                <span className="badge-coming-soon">Wkrótce</span>
              </div>
              <p className="card-muted-text">Ta funkcja będzie dostępna wkrótce.</p>
            </section>
          )}

          {summary.recentPosts.length > 0 && !FEATURE_FLAGS.analitykaOstatniePosty && (
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

          {summary.platforms.length > 0 && (
            <section className="card collapsible-card">
              <button
                type="button"
                className="collapsible-toggle"
                aria-expanded={isPlatformsOpen}
                onClick={() => setIsPlatformsOpen((prev) => !prev)}
              >
                <span>Konta i platformy</span>
                <svg
                  className={`collapsible-chevron${isPlatformsOpen ? " open" : ""}`}
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
              {isPlatformsOpen && (
                <div className="collapsible-body">
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
                </div>
              )}
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
