import { useEffect, useMemo, useState } from "react";
import type { Post, Reel } from "@mizaly/shared";
import { apiClient, ApiError } from "../../lib/apiClient";
import { Modal } from "../../components/Modal";
import { addWeeks, buildWeek, dowLabel, formatWeekRange, isSameDay, startOfWeek, toDateKey } from "./dateUtils";

const STATUS_LABELS: Record<string, string> = {
  draft: "Szkic",
  scheduled: "Zaplanowany",
  published: "Opublikowany",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5.5 8.5 12l6.5 6.5" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5.5 15.5 12 9 18.5" />
    </svg>
  );
}

export function KalendarzSection() {
  const today = useMemo(() => new Date(), []);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today));
  const [selectedKey, setSelectedKey] = useState(() => toDateKey(today));

  const weekDays = useMemo(() => buildWeek(weekStart), [weekStart]);

  const [posts, setPosts] = useState<Post[]>([]);
  const [reels, setReels] = useState<Reel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped after scheduling a draft so the day view refetches and the newly
  // scheduled post shows up under its date right away.
  const [refreshTick, setRefreshTick] = useState(0);

  // Drafts have no scheduledAt/publishedAt, so they never match the
  // date-filtered query below - fetched separately (unfiltered) so they're
  // visible/actionable somewhere instead of silently disappearing after save.
  const [drafts, setDrafts] = useState<Post[]>([]);
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(true);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  // Draft being scheduled via the date-picker modal (null = modal closed).
  const [schedulingDraft, setSchedulingDraft] = useState<Post | null>(null);
  const [scheduledFor, setScheduledFor] = useState("");
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  const loadDrafts = () => {
    setIsLoadingDrafts(true);
    apiClient
      .get<Post[]>("/api/posts")
      .then((all) => setDrafts(all.filter((post) => !post.scheduledAt && !post.publishedAt)))
      .catch(() => setDrafts([]))
      .finally(() => setIsLoadingDrafts(false));
  };

  useEffect(() => {
    loadDrafts();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    Promise.all([
      apiClient.get<Post[]>(`/api/posts?date=${selectedKey}`),
      // Backend may not support filtering reels by date, so fetch all and filter client-side below.
      apiClient.get<Reel[]>("/api/reels"),
    ])
      .then(([postsRes, reelsRes]) => {
        if (cancelled) return;
        setPosts(postsRes);
        setReels(reelsRes);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Nie udało się pobrać kalendarza.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedKey, refreshTick]);

  const reelsForDay = reels.filter((reel) => {
    const relevantDate = reel.scheduledAt || reel.publishedAt;
    return relevantDate ? relevantDate.slice(0, 10) === selectedKey : false;
  });

  const handlePublishDraft = async (id: string) => {
    setDraftError(null);
    setPublishingId(id);
    try {
      await apiClient.post(`/api/posts/${id}/publish`, { mode: "now" });
      loadDrafts();
      setRefreshTick((tick) => tick + 1);
    } catch (err) {
      setDraftError(err instanceof ApiError ? err.message : "Nie udało się opublikować posta.");
    } finally {
      setPublishingId(null);
    }
  };

  const handleScheduleDraft = async () => {
    if (!schedulingDraft || !scheduledFor) return;
    setDraftError(null);
    setPublishingId(schedulingDraft.id);
    try {
      await apiClient.post(`/api/posts/${schedulingDraft.id}/publish`, {
        mode: "schedule",
        scheduledFor: new Date(scheduledFor).toISOString(),
      });
      setSchedulingDraft(null);
      setScheduledFor("");
      loadDrafts();
      setRefreshTick((tick) => tick + 1);
    } catch (err) {
      setDraftError(err instanceof ApiError ? err.message : "Nie udało się zaplanować publikacji.");
    } finally {
      setPublishingId(null);
    }
  };

  const handleDeleteDraft = async (id: string) => {
    const previous = drafts;
    setDrafts((prev) => prev.filter((post) => post.id !== id));
    try {
      await apiClient.del(`/api/posts/${id}`);
    } catch {
      setDrafts(previous);
    }
  };

  const goToWeek = (weeks: number) => {
    const nextWeekStart = addWeeks(weekStart, weeks);
    setWeekStart(nextWeekStart);
    setSelectedKey(toDateKey(nextWeekStart));
  };

  const goToCurrentWeek = () => {
    setWeekStart(startOfWeek(today));
    setSelectedKey(toDateKey(today));
  };

  return (
    <div>
      <div className="cal-nav">
        <button type="button" className="cal-nav-btn" onClick={() => goToWeek(-1)} aria-label="Poprzedni tydzień">
          <ChevronLeft />
        </button>
        <button type="button" className="cal-nav-label" onClick={goToCurrentWeek}>
          {formatWeekRange(weekStart)}
        </button>
        <button type="button" className="cal-nav-btn" onClick={() => goToWeek(1)} aria-label="Następny tydzień">
          <ChevronRight />
        </button>
      </div>

      <div className="week-grid">
        {weekDays.map((date) => {
          const key = toDateKey(date);
          const isActive = key === selectedKey;
          const isToday = isSameDay(date, today);
          return (
            <button
              key={key}
              type="button"
              className={`day-card${isActive ? " day-card--selected" : ""}${isToday ? " day-card--today" : ""}`}
              onClick={() => setSelectedKey(key)}
            >
              <span className="day-card-name">{dowLabel(date)}</span>
              <span className="day-card-num">{date.getDate()}</span>
            </button>
          );
        })}
      </div>

      {isLoading && <p className="hint-text">Ładowanie…</p>}
      {error && <p className="error-text">{error}</p>}

      {!isLoading && !error && posts.length > 0 && (
        <section className="card">
          <h2>Posty</h2>
          <div className="list">
            {posts.map((post) => (
              <div key={post.id} className="list-item">
                <p style={{ margin: "0 0 6px", fontWeight: 600 }}>{post.heading}</p>
                <p className="hint-text" style={{ margin: "0 0 6px" }}>
                  {post.content}
                </p>
                <span className={`status-pill ${post.status}`}>{statusLabel(post.status)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!isLoading && !error && reelsForDay.length > 0 && (
        <section className="card">
          <h2>Reelsy</h2>
          <div className="list">
            {reelsForDay.map((reel) => (
              <div key={reel.id} className="list-item">
                <p style={{ margin: "0 0 6px", fontWeight: 600 }}>{reel.title}</p>
                <p className="hint-text" style={{ margin: "0 0 6px" }}>
                  {reel.description}
                </p>
                <span className={`status-pill ${reel.status}`}>{statusLabel(reel.status)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!isLoadingDrafts && drafts.length > 0 && (
        <section className="card">
          <h2>Szkice (bez daty)</h2>
          {draftError && <p className="error-text">{draftError}</p>}
          <div className="list">
            {drafts.map((post) => (
              <div key={post.id} className="list-item">
                <p style={{ margin: "0 0 6px", fontWeight: 600 }}>{post.heading}</p>
                <p className="hint-text" style={{ margin: "0 0 6px" }}>
                  {post.content}
                </p>
                {post.publishError && <p className="error-text">{post.publishError}</p>}
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={publishingId === post.id || post.platforms.length === 0}
                    onClick={() => handlePublishDraft(post.id)}
                  >
                    {publishingId === post.id ? "Publikowanie…" : "Opublikuj teraz"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={publishingId === post.id || post.platforms.length === 0}
                    onClick={() => {
                      setDraftError(null);
                      setSchedulingDraft(post);
                    }}
                  >
                    Zaplanuj
                  </button>
                  <button type="button" className="btn btn-danger btn-small" onClick={() => handleDeleteDraft(post.id)}>
                    Usuń
                  </button>
                </div>
                {post.platforms.length === 0 && (
                  <p className="hint-text" style={{ marginTop: 6 }}>
                    Ten szkic nie ma wybranych platform, więc nie można go opublikować ani zaplanować.
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {schedulingDraft && (
        <Modal
          title={`Zaplanuj: ${schedulingDraft.heading}`}
          onClose={() => {
            setSchedulingDraft(null);
            setScheduledFor("");
          }}
        >
          <div className="field">
            <label htmlFor="draftScheduledFor">Data i godzina publikacji</label>
            <input
              id="draftScheduledFor"
              type="datetime-local"
              value={scheduledFor}
              min={nowLocal}
              onChange={(e) => setScheduledFor(e.target.value)}
              autoFocus
            />
          </div>
          {draftError && <p className="error-text">{draftError}</p>}
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setSchedulingDraft(null);
                setScheduledFor("");
              }}
            >
              Anuluj
            </button>
            <button
              type="button"
              className="btn"
              disabled={!scheduledFor || publishingId === schedulingDraft.id}
              onClick={handleScheduleDraft}
            >
              {publishingId === schedulingDraft.id ? "Planowanie…" : "Zaplanuj"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
