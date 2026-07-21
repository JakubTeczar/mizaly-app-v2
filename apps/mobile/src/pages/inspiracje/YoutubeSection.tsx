import { useEffect, useMemo, useRef, useState } from "react";
import type { ScrapeProgress, WatchedYoutubeChannel, YoutubeVideoDetail, YoutubeVideoSummary } from "@mizaly/shared";
import { apiClient, ApiError } from "../../lib/apiClient";
import { WatchlistManager } from "./WatchlistManager";
import { ClassificationRanking, type ClassifiableItem } from "./ClassificationRanking";
import { TopMetricsStrip } from "./TopMetricsStrip";
import { CommentClusters } from "./CommentClusters";
import { YoutubeAccountStatsPanel } from "./YoutubeAccountStatsPanel";
import { SortControl } from "./SortControl";

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} mln`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} tys.`;
  return String(value);
}

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pl-PL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const SORT_OPTIONS = [
  { value: "date", label: "Najnowsze" },
  { value: "views", label: "Najwięcej wyświetleń" },
  { value: "likes", label: "Najwięcej polubień" },
  { value: "comments", label: "Najwięcej komentarzy" },
  { value: "normalized", label: "Odchylenie od normy kanału" },
];

// Same rationale/pattern as TrendsFeed.tsx's PAGE_SIZE - renders the video
// grid incrementally via IntersectionObserver instead of mounting every
// thumbnail at once.
const PAGE_SIZE = 10;

function VideoDetail({ videoId, onBack }: { videoId: string; onBack: () => void }) {
  const [video, setVideo] = useState<YoutubeVideoDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<YoutubeVideoDetail>(`/api/youtube-videos/${videoId}`)
      .then(setVideo)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Nie udało się pobrać filmu."));
  }, [videoId]);

  return (
    <div>
      <div className="favorites-header">
        <button type="button" className="btn btn-secondary btn-small" onClick={onBack}>
          ← Wróć
        </button>
        <h2 className="favorites-title">{video?.title ?? "Film"}</h2>
      </div>

      {loadError && <p className="error-text">{loadError}</p>}
      {!video && !loadError && <p className="hint-text">Ładowanie…</p>}

      {video && (
        <section className="card">
          {video.thumbnailUrl && (
            <img
              src={video.thumbnailUrl}
              alt={video.title}
              style={{ width: "100%", borderRadius: 12, marginBottom: 12 }}
            />
          )}
          <div className="insta-post-stats">
            <span>{formatCount(video.viewCount)} wyświetleń</span>
            <span>{formatCount(video.likeCount)} polubień</span>
            <span>{formatCount(video.commentCount)} komentarzy</span>
          </div>
          {/* videoId is YouTube's own video id (see ScrapedYoutubeVideo in
              schema.prisma), so the watch URL is constructable directly. */}
          <a
            href={`https://www.youtube.com/watch?v=${videoId}`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary btn-small"
            style={{ marginTop: 12 }}
          >
            Zobacz oryginał
          </a>
        </section>
      )}
    </div>
  );
}

export function YoutubeSection() {
  const [channels, setChannels] = useState<WatchedYoutubeChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsError, setChannelsError] = useState<string | null>(null);

  const [videos, setVideos] = useState<YoutubeVideoSummary[]>([]);
  const [videosLoading, setVideosLoading] = useState(true);
  const [videosError, setVideosError] = useState<string | null>(null);
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("date");
  const [scrapeProgress, setScrapeProgress] = useState<ScrapeProgress | null>(null);
  const wasScrapeRunningRef = useRef(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const scrollSentinelRef = useRef<HTMLDivElement | null>(null);

  const loadVideos = async (sort: string) => {
    try {
      const result = await apiClient.get<YoutubeVideoSummary[]>(`/api/youtube-videos?sortBy=${sort}`);
      setVideos(result);
      setVisibleCount(PAGE_SIZE);
    } catch (err) {
      setVideosError(err instanceof ApiError ? err.message : "Nie udało się pobrać filmów.");
    }
  };

  useEffect(() => {
    apiClient
      .get<WatchedYoutubeChannel[]>("/api/youtube-channels")
      .then(setChannels)
      .catch((err) => setChannelsError(err instanceof ApiError ? err.message : "Nie udało się pobrać kanałów."))
      .finally(() => setChannelsLoading(false));
  }, []);

  useEffect(() => {
    setVideosLoading(true);
    loadVideos(sortBy).finally(() => setVideosLoading(false));
  }, [sortBy]);

  // Polls the scrape status (shared by the manual "Pobierz teraz" click and
  // the hourly background job - see jobs/youtubeScrapeJob.ts) so the
  // "Pobrano X z Y kanałów" banner reflects a scrape started from either source.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await apiClient.get<ScrapeProgress>("/api/youtube-videos/scrape-status");
        if (cancelled) return;
        setScrapeProgress(status);
        if (wasScrapeRunningRef.current && !status.isRunning) {
          loadVideos(sortBy);
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

  const lastScrapedAt = videos.reduce<string | null>(
    (max, v) => (!max || v.scrapedAt > max ? v.scrapedAt : max),
    null
  );

  // Ranked by outlierRatio (how far a video deviates from its OWN channel's
  // usual pace), not raw views - a plain "most views" top 3 is dominated by
  // whichever channel is biggest/oldest, not by what's actually unusual.
  const topVideos = useMemo(
    () =>
      [...videos]
        .filter((video) => typeof video.outlierRatio === "number")
        .sort((a, b) => (b.outlierRatio as number) - (a.outlierRatio as number))
        .slice(0, 3)
        .map((video) => ({
          id: video.id,
          title: video.title,
          valueLabel: `${(video.outlierRatio as number).toFixed(1)}x normy @${video.channelHandle}`,
          thumbnailUrl: video.thumbnailUrl,
          onClick: () => setSelectedVideoId(video.id),
        })),
    [videos]
  );

  // Memoized on `videos` specifically (not recreated on every render) - this
  // page polls /scrape-status every 2s (see the effect above), which
  // re-renders YoutubeSection constantly even when videos hasn't changed.
  // Without this, mapping videos inline in JSX would produce a brand-new
  // array every ~2s; ClassificationRanking's own useMemo would then see a
  // "changed" items reference and recompute, handing GroupItemCarousel a new
  // `items` prop - whose effect resets the carousel back to slide 1 every
  // couple of seconds, making manual next/prev navigation look broken.
  const classifiableItems = useMemo(
    (): ClassifiableItem[] =>
      videos.map((video) => ({
        id: video.id,
        topic: video.topic,
        format: video.format,
        hook: video.hook,
        outlierRatio: video.outlierRatio,
        isMature: video.isMature,
        thumbnailUrl: video.thumbnailUrl,
        likesCount: video.likeCount,
        commentsCount: video.commentCount,
        viewsCount: video.viewCount,
        title: video.title,
        onOpen: () => setSelectedVideoId(video.id),
      })),
    [videos]
  );

  const visibleVideos = useMemo(() => videos.slice(0, visibleCount), [videos, visibleCount]);

  // Grows visibleCount once the sentinel comes within one screen of the
  // viewport - same pattern as TrendsFeed.tsx.
  useEffect(() => {
    const node = scrollSentinelRef.current;
    if (!node || visibleCount >= videos.length) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, videos.length));
        }
      },
      { rootMargin: "800px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [videos.length, visibleCount]);

  const handleScrapeNow = async () => {
    setIsScraping(true);
    setScrapeError(null);
    try {
      await apiClient.post("/api/youtube-videos/scrape-now");
      await loadVideos(sortBy);
    } catch (err) {
      setScrapeError(err instanceof ApiError ? err.message : "Nie udało się pobrać nowych filmów.");
    } finally {
      setIsScraping(false);
    }
  };

  const handleAddChannel = async (handle: string) => {
    const created = await apiClient.post<WatchedYoutubeChannel>("/api/youtube-channels", { handle });
    setChannels((prev) => [...prev, created]);
  };

  const handleRemoveChannel = async (id: string) => {
    const previous = channels;
    setChannels((prev) => prev.filter((c) => c.id !== id));
    try {
      await apiClient.del(`/api/youtube-channels/${id}`);
    } catch {
      setChannels(previous);
    }
  };

  if (selectedVideoId) {
    return <VideoDetail videoId={selectedVideoId} onBack={() => setSelectedVideoId(null)} />;
  }

  return (
    <>
      <WatchlistManager
        title="Obserwowane kanały"
        description="Skąd pobieramy inspiracje z YouTube'a - pierwsze dodanie pobiera ok. miesiąca filmów wstecz, później tylko nowe."
        placeholder="np. @NazwaKanalu"
        items={channels.map((c) => ({ id: c.id, label: c.displayName ? c.displayName : `@${c.handle}` }))}
        isLoading={channelsLoading}
        loadError={channelsError}
        onAdd={handleAddChannel}
        onRemove={handleRemoveChannel}
      />
      <YoutubeAccountStatsPanel />

      <CommentClusters platform="youtube" />
      <ClassificationRanking items={classifiableItems} axes={["topic", "format", "hook"]} />
      <TopMetricsStrip heading="Top 3 - odchylenie od normy kanału" items={topVideos} />

      <section className="card">
        <div className="card-header-row">
          <h2>Filmy</h2>
          <button type="button" className="btn btn-secondary btn-small" disabled={isScraping} onClick={handleScrapeNow}>
            {isScraping ? "Pobieranie…" : "Pobierz teraz"}
          </button>
        </div>
        {scrapeProgress?.isRunning && (
          <p className="hint-text" style={{ marginBottom: 10 }}>
            Pobieranie w tle. Pobrano {scrapeProgress.done} z {scrapeProgress.total} kanałów
            {scrapeProgress.current ? ` (aktualnie: ${scrapeProgress.current})` : ""}.
          </p>
        )}
        {!scrapeProgress?.isRunning && lastScrapedAt && (
          <p className="hint-text" style={{ marginBottom: 10 }}>
            Ostatnio pobrano: {formatDateTime(lastScrapedAt)}
          </p>
        )}
        {scrapeError && <p className="error-text">{scrapeError}</p>}
        <SortControl value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} />
        {videosLoading && <p className="hint-text">Ładowanie…</p>}
        {videosError && <p className="error-text">{videosError}</p>}
        {!videosLoading && !videosError && videos.length === 0 && (
          <p className="card-muted-text">Filmy pojawią się po pierwszym pobraniu danych z obserwowanych kanałów.</p>
        )}
        {videos.length > 0 && (
          <div className="youtube-grid">
            {visibleVideos.map((video) => (
              <button
                key={video.id}
                type="button"
                className="youtube-card"
                onClick={() => setSelectedVideoId(video.id)}
              >
                {video.thumbnailUrl && <img className="youtube-card-thumb" src={video.thumbnailUrl} alt={video.title} loading="lazy" />}
                <div className="youtube-card-body">
                  <p className="youtube-card-title">{video.title}</p>
                  <div className="insta-post-stats">
                    <span>{formatCount(video.viewCount)} wyśw.</span>
                    <span>{formatCount(video.likeCount)} lajków</span>
                    <span>{formatCount(video.commentCount)} kom.</span>
                  </div>
                  {video.isMature === false ? (
                    <span className="outlier-badge outlier-badge--immature">jeszcze rośnie</span>
                  ) : (
                    typeof video.outlierRatio === "number" && (
                      <span className="outlier-badge">{video.outlierRatio.toFixed(1)}x normy kanału</span>
                    )
                  )}
                  {video.publishedAt && <span className="insta-post-date">{formatDate(video.publishedAt)}</span>}
                </div>
              </button>
            ))}
          </div>
        )}

        {!videosLoading && !videosError && visibleCount < videos.length && (
          <>
            <div ref={scrollSentinelRef} aria-hidden="true" />
            <p className="hint-text" style={{ textAlign: "center", marginTop: 10 }}>
              Ładowanie kolejnych…
            </p>
          </>
        )}
      </section>
    </>
  );
}
