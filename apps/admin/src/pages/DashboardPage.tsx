// MVP dashboard: static placeholder metrics until real business analytics
// are wired up to the backend (see docs/ROADMAP.md, section 5 — "Metryki biznesowe").
const MOCK_METRICS = [
  { label: "Aktywni użytkownicy", value: "12" },
  { label: "Przychód MRR", value: "0 zł (brak płatnego planu)" },
  { label: "Wykorzystanie limitów", value: "—" },
  { label: "Podłączone konta social media", value: "0" },
];

export default function DashboardPage() {
  return (
    <div>
      <h1>Dashboard</h1>
      <p className="page-subtitle">Przegląd metryk biznesowych Mizaly.</p>

      <div className="metric-grid">
        {MOCK_METRICS.map((metric) => (
          <div key={metric.label} className="metric-card">
            <div className="metric-card__label">{metric.label}</div>
            <div className="metric-card__value">{metric.value}</div>
          </div>
        ))}
      </div>

      <p className="notice">Prawdziwe metryki biznesowe będą podłączone później.</p>
    </div>
  );
}
