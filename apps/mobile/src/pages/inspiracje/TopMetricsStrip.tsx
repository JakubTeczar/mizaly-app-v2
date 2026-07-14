export interface TopMetricItem {
  id: string;
  title: string;
  valueLabel: string;
  thumbnailUrl?: string;
  onClick?: () => void;
}

// Purely mathematical "top 3" ranking (by whichever metric the caller
// already sorted `items` by) - no AI involved, computed client-side from
// data the section already fetched. Separate from AiInsightCard, which is
// the actual language-understanding analysis (emotions/questions/themes).
export function TopMetricsStrip({ items, heading }: { items: TopMetricItem[]; heading: string }) {
  if (items.length === 0) return null;

  return (
    <section className="card">
      <h2>{heading}</h2>
      <div className="top-metrics-row">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={`top-metric-card${item.onClick ? "" : " top-metric-card-static"}`}
            onClick={item.onClick ?? undefined}
          >
            <span className="top-metric-rank">#{index + 1}</span>
            {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" className="top-metric-thumb" />}
            <p className="top-metric-title">{item.title}</p>
            <p className="hint-text">{item.valueLabel}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
