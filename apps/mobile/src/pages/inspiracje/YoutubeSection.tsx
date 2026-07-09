import { useEffect, useState } from "react";
import type {
  WatchedYoutubeChannel,
  YoutubeAnalysisAction,
  YoutubeVideoDetail,
  YoutubeVideoSummary,
} from "@mizaly/shared";
import { apiClient, ApiError } from "../../lib/apiClient";
import { WatchlistManager } from "./WatchlistManager";

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} mln`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} tys.`;
  return String(value);
}

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
}

const ANALYSIS_ACTIONS: { id: YoutubeAnalysisAction; label: string }[] = [
  { id: "summarize", label: "Streść mi transkrypcję" },
  { id: "objections", label: "Sprawdź obiekcje w komentarzach" },
  { id: "topics", label: "Znajdź powtarzające się tematy" },
];

function VideoDetail({ videoId, onBack }: { videoId: string; onBack: () => void }) {
  const [video, setVideo] = useState<YoutubeVideoDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<YoutubeAnalysisAction | null>(null);
  const [results, setResults] = useState<Partial<Record<YoutubeAnalysisAction, string>>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<YoutubeVideoDetail>(`/api/youtube-videos/${videoId}`)
      .then(setVideo)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Nie udało się pobrać filmu."));
  }, [videoId]);

  const runAction = async (action: YoutubeAnalysisAction) => {
    setActionError(null);
    setRunningAction(action);
    try {
      const res = await apiClient.post<{ result: string }>(`/api/youtube-videos/${videoId}/analyze`, { action });
      setResults((prev) => ({ ...prev, [action]: res.result }));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Nie udało się wykonać analizy.");
    } finally {
      setRunningAction(null);
    }
  };

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
        <>
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
          </section>

          <section className="card">
            <h2>Analiza AI</h2>
            {actionError && <p className="error-text">{actionError}</p>}
            {ANALYSIS_ACTIONS.map((action) => (
              <div key={action.id} style={{ marginBottom: 14 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={runningAction === action.id}
                  onClick={() => runAction(action.id)}
                >
                  {runningAction === action.id ? "Analizuję…" : action.label}
                </button>
                {results[action.id] && <p className="analysis-text" style={{ marginTop: 10 }}>{results[action.id]}</p>}
              </div>
            ))}
          </section>
        </>
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

  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<WatchedYoutubeChannel[]>("/api/youtube-channels")
      .then(setChannels)
      .catch((err) => setChannelsError(err instanceof ApiError ? err.message : "Nie udało się pobrać kanałów."))
      .finally(() => setChannelsLoading(false));

    apiClient
      .get<YoutubeVideoSummary[]>("/api/youtube-videos")
      .then(setVideos)
      .catch((err) => setVideosError(err instanceof ApiError ? err.message : "Nie udało się pobrać filmów."))
      .finally(() => setVideosLoading(false));
  }, []);

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
        description="Skąd pobieramy inspiracje z YouTube'a - 3 najnowsze filmy z każdego kanału."
        placeholder="np. @NazwaKanalu"
        items={channels.map((c) => ({ id: c.id, label: c.displayName ? c.displayName : `@${c.handle}` }))}
        isLoading={channelsLoading}
        loadError={channelsError}
        onAdd={handleAddChannel}
        onRemove={handleRemoveChannel}
      />

      <section className="card">
        <h2>Filmy</h2>
        {videosLoading && <p className="hint-text">Ładowanie…</p>}
        {videosError && <p className="error-text">{videosError}</p>}
        {!videosLoading && !videosError && videos.length === 0 && (
          <p className="card-muted-text">Filmy pojawią się po pierwszym pobraniu danych z obserwowanych kanałów.</p>
        )}
        {videos.length > 0 && (
          <div className="youtube-grid">
            {videos.map((video) => (
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
                  {video.publishedAt && <span className="insta-post-date">{formatDate(video.publishedAt)}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
