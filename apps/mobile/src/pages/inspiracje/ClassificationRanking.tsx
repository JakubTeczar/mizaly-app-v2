import { useMemo, useState } from "react";

interface ClassifiableItem {
  topic?: string | null;
  format?: string | null;
  hook?: string | null;
  outlierRatio?: number | null;
  isMature?: boolean;
}

interface RankedGroup {
  label: string;
  avgRatio: number;
  count: number;
}

type Axis = "topic" | "format" | "hook";

// Groups with fewer than this many mature, classified posts are dropped -
// a single post trivially "beats the norm" or not, that's not a pattern.
const MIN_GROUP_SIZE = 2;

const AXES: { key: Axis; label: string }[] = [
  { key: "topic", label: "Temat" },
  { key: "format", label: "Format" },
  { key: "hook", label: "Hook" },
];

function rankBy(items: ClassifiableItem[], axis: Axis): RankedGroup[] {
  const ratiosByLabel = new Map<string, number[]>();
  for (const item of items) {
    const label = item[axis];
    if (!label || label === "inne") continue;
    if (item.isMature === false || typeof item.outlierRatio !== "number") continue;
    const list = ratiosByLabel.get(label) ?? [];
    list.push(item.outlierRatio);
    ratiosByLabel.set(label, list);
  }

  return Array.from(ratiosByLabel.entries())
    .map(([label, ratios]) => ({
      label,
      avgRatio: ratios.reduce((sum, r) => sum + r, 0) / ratios.length,
      count: ratios.length,
    }))
    .filter((group) => group.count >= MIN_GROUP_SIZE)
    .sort((a, b) => b.avgRatio - a.avgRatio);
}

// Aggregates the topic/format/hook classification (lib/contentClassification.ts
// on the backend) against the self-baseline outlierRatio (Faza 2) into a
// ranked list per axis - replaces the old single free-text AiInsightCard,
// which turned out not to be actionable enough on its own.
export function ClassificationRanking({ items }: { items: ClassifiableItem[] }) {
  const [axis, setAxis] = useState<Axis>("topic");

  const groups = useMemo(() => rankBy(items, axis), [items, axis]);

  return (
    <section className="card">
      <h2>Co działa najlepiej</h2>
      <div className="sub-tabs">
        {AXES.map((a) => (
          <button key={a.key} type="button" className={axis === a.key ? "active" : ""} onClick={() => setAxis(a.key)}>
            {a.label}
          </button>
        ))}
      </div>
      {groups.length === 0 ? (
        <p className="card-muted-text">
          Jeszcze za mało sklasyfikowanych i dojrzałych postów, żeby to policzyć - wróć po kolejnym pobraniu.
        </p>
      ) : (
        <div className="stat-rows">
          {groups.map((group) => (
            <div key={group.label} className="stat-row">
              <div className="stat-row-label">
                {group.label}
                <div className="hint-text">{group.count} postów</div>
              </div>
              <div className="stat-row-value">{group.avgRatio.toFixed(1)}x normy</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
