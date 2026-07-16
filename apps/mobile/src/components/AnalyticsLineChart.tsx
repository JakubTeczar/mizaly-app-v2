import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export interface AnalyticsChartPoint {
  date: string;
  value: number;
}

interface AnalyticsLineChartProps {
  points: AnalyticsChartPoint[];
  formatValue: (value: number) => string;
  formatDate: (dateKey: string) => string;
}

const MIN_POINT_GAP = 34;
const CHART_HEIGHT = 168;
const PADDING_TOP = 18;
const PADDING_BOTTOM = 26;
const PADDING_X = 12;
const PLOT_HEIGHT = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

function niceMax(value: number): number {
  if (value <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function AnalyticsLineChart({ points, formatValue, formatDate }: AnalyticsLineChartProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeIndex, setActiveIndex] = useState(points.length - 1);
  const [containerWidth, setContainerWidth] = useState(0);

  // Few points spread out to fill the card; many points keep a fixed
  // spacing and let the container scroll horizontally instead of cramming.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => setContainerWidth(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const maxValue = useMemo(() => niceMax(Math.max(...points.map((p) => p.value), 1)), [points]);

  const plotWidth = Math.max(containerWidth - PADDING_X * 2, 0);
  const pointGap = points.length > 1 ? Math.max(MIN_POINT_GAP, plotWidth / (points.length - 1)) : MIN_POINT_GAP;
  const width = Math.max(containerWidth, PADDING_X * 2 + Math.max(points.length - 1, 1) * pointGap);

  const positions = points.map((point, i) => ({
    x: PADDING_X + i * pointGap,
    y: PADDING_TOP + PLOT_HEIGHT - (point.value / maxValue) * PLOT_HEIGHT,
  }));

  const linePath = positions.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const baseline = PADDING_TOP + PLOT_HEIGHT;
  const areaPath = `${linePath} L${positions[positions.length - 1].x},${baseline} L${positions[0].x},${baseline} Z`;

  const labelStep = Math.max(Math.ceil(points.length / 6), 1);

  // Opens scrolled to the most recent point, so "today" is what a reader sees first.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [points, width]);

  useEffect(() => {
    setActiveIndex(points.length - 1);
  }, [points]);

  const moveToClientX = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = clientX - rect.left;
    let closest = 0;
    let closestDist = Infinity;
    positions.forEach((pos, i) => {
      const dist = Math.abs(pos.x - x);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    setActiveIndex(closest);
  };

  const handlePointer = (event: ReactPointerEvent<SVGSVGElement>) => moveToClientX(event.clientX);

  const active = points[activeIndex];
  const activePos = positions[activeIndex];
  const tooltipTransform =
    activeIndex === 0 ? "translateX(0)" : activeIndex === points.length - 1 ? "translateX(-100%)" : "translateX(-50%)";

  return (
    <div className="analytics-chart">
      <div className="analytics-chart-axis">
        <span>{formatValue(maxValue)}</span>
        <span>0</span>
      </div>

      <div className="analytics-chart-scroll" ref={scrollRef}>
        {containerWidth > 0 && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
            className="analytics-chart-svg"
            style={{ width: `${width}px` }}
            onPointerMove={handlePointer}
            onPointerDown={handlePointer}
            role="img"
            aria-label="Wykres wyświetleń w czasie"
          >
            <defs>
              <linearGradient id="analyticsChartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.16" />
                <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {[0, 0.5, 1].map((fraction) => (
              <line
                key={fraction}
                x1={0}
                x2={width}
                y1={PADDING_TOP + PLOT_HEIGHT * (1 - fraction)}
                y2={PADDING_TOP + PLOT_HEIGHT * (1 - fraction)}
                className="analytics-chart-grid"
              />
            ))}

            <path d={areaPath} fill="url(#analyticsChartFill)" stroke="none" />
            <path d={linePath} className="analytics-chart-line" fill="none" />

            <line
              x1={activePos.x}
              x2={activePos.x}
              y1={PADDING_TOP}
              y2={baseline}
              className="analytics-chart-crosshair"
            />

            {positions.map((pos, i) =>
              i === activeIndex || i === positions.length - 1 ? (
                <circle key={i} cx={pos.x} cy={pos.y} r={4} className="analytics-chart-dot" />
              ) : null
            )}

            {points.map((point, i) =>
              i % labelStep === 0 || i === points.length - 1 ? (
                <text
                  key={point.date}
                  x={positions[i].x}
                  y={CHART_HEIGHT - 8}
                  textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
                  className="analytics-chart-axis-label"
                >
                  {formatDate(point.date)}
                </text>
              ) : null
            )}
          </svg>
        )}

        {containerWidth > 0 && (
          <div className="analytics-chart-tooltip" style={{ left: activePos.x, transform: tooltipTransform }}>
            <div className="analytics-chart-tooltip-value">{formatValue(active.value)}</div>
            <div className="analytics-chart-tooltip-date">{formatDate(active.date)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
