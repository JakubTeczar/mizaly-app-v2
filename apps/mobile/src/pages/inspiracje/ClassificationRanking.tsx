import { useMemo, useState } from "react";

// Normalized shape so this component doesn't need to know whether it's
// rendering Instagram posts or YouTube videos - each caller (TrendsFeed.tsx,
// YoutubeSection.tsx) maps its own item shape into this one. hookText/
// hookVisual/cta/ctaDetail/visualDescription/visualText/transcriptExcerpt are
// Instagram-only (see lib/contentClassification.ts on the backend) - YouTube
// keeps using the single legacy `hook` field.
export interface ClassifiableItem {
  id: string;
  topic?: string | null;
  format?: string | null;
  hook?: string | null;
  hookText?: string | null;
  hookVisual?: string | null;
  cta?: string | null;
  ctaDetail?: string | null;
  visualDescription?: string | null;
  visualText?: string | null;
  transcriptExcerpt?: string | null;
  outlierRatio?: number | null;
  isMature?: boolean;
  thumbnailUrl?: string | null;
  title: string;
  externalUrl?: string | null;
  onOpen?: () => void;
}

interface RankedGroup {
  label: string;
  avgRatio: number;
  count: number;
  items: ClassifiableItem[];
}

export type Axis = "topic" | "format" | "hook" | "hookText" | "hookVisual" | "cta";

const AXIS_LABELS: Record<Axis, string> = {
  topic: "Temat",
  format: "Format",
  hook: "Hook",
  hookText: "Hook (tekst)",
  hookVisual: "Hook (wizualny)",
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

// What to show for one item when its group is expanded - depends on the axis,
// since "what exactly is this hook/format/topic" means different underlying
// data per axis (see contentClassification.ts): format wants the actual
// post/reel itself; hookText the literal opening wording; hookVisual what's
// shown in the frame/image; topic the fuller transcript/caption context; cta
// the literal CTA quote.
function detailTextForAxis(item: ClassifiableItem, axis: Axis): string {
  switch (axis) {
    case "hookText":
      return item.visualText || item.transcriptExcerpt || item.title;
    case "hookVisual":
      return item.visualDescription || item.title;
    case "cta":
      return item.ctaDetail || item.title;
    case "topic":
    case "format":
    case "hook":
    default:
      return item.transcriptExcerpt || item.title;
  }
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
                    {group.items.map((item) => {
                      const content = (
                        <>
                          {item.thumbnailUrl && (
                            <img className="stat-row-detail-thumb" src={item.thumbnailUrl} alt="" loading="lazy" />
                          )}
                          <div className="stat-row-detail-text">
                            <div>{detailTextForAxis(item, axis)}</div>
                            <div className="stat-row-detail-meta">
                              {typeof item.outlierRatio === "number" ? `${item.outlierRatio.toFixed(1)}x normy` : null}
                            </div>
                          </div>
                        </>
                      );
                      return item.externalUrl ? (
                        <a
                          key={item.id}
                          className="stat-row-detail-item stat-row-detail-link"
                          href={item.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {content}
                        </a>
                      ) : (
                        <div
                          key={item.id}
                          className={`stat-row-detail-item${item.onOpen ? " stat-row-detail-link" : ""}`}
                          onClick={item.onOpen}
                          role={item.onOpen ? "button" : undefined}
                        >
                          {content}
                        </div>
                      );
                    })}
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
