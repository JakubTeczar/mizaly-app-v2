import { useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { ChevronIcon } from "../../components/ChevronIcon";

// Normalized shape so this component doesn't need to know whether it's
// rendering Instagram posts or YouTube videos - each caller (TrendsFeed.tsx,
// YoutubeSection.tsx) maps its own item shape into this one. Both platforms
// now share the single unified `hook` axis (one judgment per post/video, not
// split into text/visual) - `hookDetail`/cta/ctaDetail/visualDescription/
// visualText/transcriptExcerpt are Instagram-only (see
// lib/contentClassification.ts on the backend), YouTube just doesn't have a
// literal-quote detail for its hook yet.
export interface ClassifiableItem {
  id: string;
  topic?: string | null;
  format?: string | null;
  hook?: string | null;
  hookDetail?: string | null;
  cta?: string | null;
  ctaDetail?: string | null;
  visualDescription?: string | null;
  visualText?: string | null;
  transcriptExcerpt?: string | null;
  outlierRatio?: number | null;
  isMature?: boolean;
  thumbnailUrl?: string | null;
  videoUrl?: string | null;
  isReel?: boolean;
  likesCount?: number | null;
  commentsCount?: number | null;
  viewsCount?: number | null;
  title: string;
  externalUrl?: string | null;
  onOpen?: () => void;
}

// Small graphic marker for what kind of post this is (plain image vs Reel vs
// a non-Reel video) - shown over the thumbnail in both the main feed
// (TrendsFeed.tsx) and this component's expanded-group carousel, since
// otherwise a post's type is only guessable from whether it happens to
// autoplay.
function MediaTypeIcon({ kind }: { kind: "image" | "video" }) {
  if (kind === "video") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M10 8.3v7.4l6-3.7z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" stroke="none" />
      <path d="M21 15l-5-5-9 9" />
    </svg>
  );
}

export function MediaTypeBadge({ videoUrl, isReel }: { videoUrl?: string | null; isReel?: boolean }) {
  if (videoUrl) {
    return (
      <span className="insta-post-reel-badge">
        <MediaTypeIcon kind="video" />
        {isReel ? "Reels" : "Wideo"}
      </span>
    );
  }
  return (
    <span className="insta-post-reel-badge">
      <MediaTypeIcon kind="image" />
      Zdjęcie
    </span>
  );
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} mln`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} tys.`;
  return String(value);
}

interface RankedGroup {
  label: string;
  avgRatio: number;
  count: number;
  items: ClassifiableItem[];
}

export type Axis = "topic" | "format" | "hook" | "cta";

const AXIS_LABELS: Record<Axis, string> = {
  topic: "Temat",
  format: "Format",
  hook: "Hook",
  cta: "CTA",
};

// Groups with fewer than this many mature, classified posts are dropped -
// a single post trivially "beats the norm" or not, that's not a pattern.
const MIN_GROUP_SIZE = 2;

function rankBy(items: ClassifiableItem[], axis: Axis): RankedGroup[] {
  const itemsByLabel = new Map<string, { item: ClassifiableItem; ratio: number }[]>();
  for (const item of items) {
    const label = item[axis];
    if (!label || label === "inne") continue;
    if (item.isMature === false || typeof item.outlierRatio !== "number") continue;
    const list = itemsByLabel.get(label) ?? [];
    list.push({ item, ratio: item.outlierRatio });
    itemsByLabel.set(label, list);
  }

  return Array.from(itemsByLabel.entries())
    .map(([label, entries]) => ({
      label,
      avgRatio: entries.reduce((sum, e) => sum + e.ratio, 0) / entries.length,
      count: entries.length,
      items: entries.map((e) => e.item).sort((a, b) => (b.outlierRatio ?? 0) - (a.outlierRatio ?? 0)),
    }))
    .filter((group) => group.count >= MIN_GROUP_SIZE)
    .sort((a, b) => b.avgRatio - a.avgRatio);
}

// A short caption shown above the excerpt text in the expanded-group
// carousel, so it reads as "this is the CTA line" rather than looking like
// the post's entire caption - without it, a one-sentence CTA/hook excerpt
// next to a full post thumbnail reads as if that sentence were the whole post.
const AXIS_DETAIL_LABEL: Record<Axis, string> = {
  topic: "Fragment posta",
  format: "Fragment posta",
  hook: "Otwierające zdanie (hook)",
  cta: "Ostatnie zdanie posta (CTA)",
};

// What to show for one item when its group is expanded - depends on the axis,
// since "what exactly is this hook/format/topic" means different underlying
// data per axis (see contentClassification.ts): hook wants the literal
// hookDetail quote (falls back to YouTube's plain transcript excerpt, since
// YouTube's `hook` axis doesn't have a detail field yet); cta the literal CTA
// quote; topic/format the fuller transcript/caption context.
function detailTextForAxis(item: ClassifiableItem, axis: Axis): string {
  switch (axis) {
    case "hook":
      return item.hookDetail || item.transcriptExcerpt || item.title;
    case "cta":
      return item.ctaDetail || item.title;
    case "topic":
    case "format":
    default:
      return item.transcriptExcerpt || item.title;
  }
}

// Swipeable strip of the actual posts/reels behind one expanded group - same
// touch-swipe + arrows + dots pattern as PostPreview.tsx's image carousel, so
// a reader can see the photo/video and read the text without leaving the
// page (a click-through to externalUrl/onOpen is still offered per item, but
// it's a supplementary "see the original", not the primary way to view it).
function GroupItemCarousel({ items, axis }: { items: ClassifiableItem[]; axis: Axis }) {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => setIndex(0), [items]);

  if (items.length === 0) return null;
  const clampedIndex = Math.min(index, items.length - 1);
  const goTo = (next: number) => setIndex(Math.max(0, Math.min(items.length - 1, next)));

  const handleTouchStart = (event: TouchEvent) => {
    touchStartX.current = event.touches[0].clientX;
  };
  const handleTouchEnd = (event: TouchEvent) => {
    if (touchStartX.current === null) return;
    const deltaX = event.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(deltaX) < 40) return;
    goTo(clampedIndex + (deltaX < 0 ? 1 : -1));
  };

  const item = items[clampedIndex];
  const hasVideo = Boolean(item.videoUrl);

  return (
    <div className="group-item-carousel">
      <div
        className="group-item-carousel-viewport"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <MediaTypeBadge videoUrl={item.videoUrl} isReel={item.isReel} />
        {hasVideo ? (
          <video
            key={item.id}
            className="group-item-carousel-media"
            src={item.videoUrl!}
            poster={item.thumbnailUrl || undefined}
            controls
            playsInline
            preload="metadata"
          />
        ) : item.thumbnailUrl ? (
          item.onOpen ? (
            <button type="button" className="group-item-carousel-media-btn" onClick={item.onOpen}>
              <img className="group-item-carousel-media" src={item.thumbnailUrl} alt="" loading="lazy" />
            </button>
          ) : (
            <img className="group-item-carousel-media" src={item.thumbnailUrl} alt="" loading="lazy" />
          )
        ) : (
          <div className="group-item-carousel-media group-item-carousel-media--empty" />
        )}

        {items.length > 1 && (
          <>
            <button
              type="button"
              className="preview-carousel-arrow preview-carousel-arrow--left"
              aria-label="Poprzedni"
              onClick={() => goTo(clampedIndex - 1)}
              disabled={clampedIndex === 0}
            >
              <ChevronIcon direction="left" />
            </button>
            <button
              type="button"
              className="preview-carousel-arrow preview-carousel-arrow--right"
              aria-label="Następny"
              onClick={() => goTo(clampedIndex + 1)}
              disabled={clampedIndex === items.length - 1}
            >
              <ChevronIcon direction="right" />
            </button>
            <div className="preview-carousel-dots">
              {items.map((_, i) => (
                <span key={i} className={`preview-carousel-dot${i === clampedIndex ? " active" : ""}`} />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="group-item-carousel-text">
        {typeof item.outlierRatio === "number" && (
          <span className="outlier-badge">{item.outlierRatio.toFixed(1)}x normy</span>
        )}
        <div className="group-item-carousel-label">{AXIS_DETAIL_LABEL[axis]}</div>
        <div>{detailTextForAxis(item, axis)}</div>
        {(item.likesCount != null || item.commentsCount != null || item.viewsCount != null) && (
          <div className="group-item-carousel-stats">
            {item.viewsCount != null && <span>{formatCount(item.viewsCount)} wyświetleń</span>}
            {item.likesCount != null && <span>{formatCount(item.likesCount)} polubień</span>}
            {item.commentsCount != null && <span>{formatCount(item.commentsCount)} komentarzy</span>}
          </div>
        )}
        {item.externalUrl && (
          <a href={item.externalUrl} target="_blank" rel="noreferrer" className="group-item-carousel-link">
            Zobacz oryginał →
          </a>
        )}
      </div>
    </div>
  );
}

// Aggregates the topic/format/hook classification (lib/contentClassification.ts
// on the backend) against the self-baseline outlierRatio (Faza 2) into a
// ranked list per axis - replaces the old single free-text AiInsightCard,
// which turned out not to be actionable enough on its own. Each group row
// expands (inline accordion) to show the actual posts/videos behind it.
export function ClassificationRanking({ items, axes }: { items: ClassifiableItem[]; axes: Axis[] }) {
  const [axis, setAxis] = useState<Axis>(axes[0]);
  const [expandedLabel, setExpandedLabel] = useState<string | null>(null);

  const groups = useMemo(() => rankBy(items, axis), [items, axis]);

  function selectAxis(next: Axis) {
    setAxis(next);
    setExpandedLabel(null);
  }

  return (
    <section className="card">
      <h2>Co działa najlepiej</h2>
      <div className="sub-tabs">
        {axes.map((key) => (
          <button key={key} type="button" className={axis === key ? "active" : ""} onClick={() => selectAxis(key)}>
            {AXIS_LABELS[key]}
          </button>
        ))}
      </div>
      {groups.length === 0 ? (
        <p className="card-muted-text">
          Jeszcze za mało sklasyfikowanych i dojrzałych postów, żeby to policzyć - wróć po kolejnym pobraniu.
        </p>
      ) : (
        <div className="stat-rows">
          {groups.map((group) => {
            const isOpen = expandedLabel === group.label;
            return (
              <div key={group.label} className="stat-row-group">
                <button
                  type="button"
                  className="stat-row stat-row-toggle"
                  aria-expanded={isOpen}
                  onClick={() => setExpandedLabel(isOpen ? null : group.label)}
                >
                  <div className="stat-row-label">
                    {group.label}
                    <div className="hint-text">{group.count} postów</div>
                  </div>
                  <div className="stat-row-value">{group.avgRatio.toFixed(1)}x normy</div>
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
                    <GroupItemCarousel items={group.items} axis={axis} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
