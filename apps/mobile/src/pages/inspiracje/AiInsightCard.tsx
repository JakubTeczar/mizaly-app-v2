import { useEffect, useState } from "react";
import { apiClient } from "../../lib/apiClient";

interface InsightResponse {
  status: "ok" | "pending";
  message?: string;
  content?: string;
  createdAt?: string;
}

// Section-level AI write-up (emotions/questions/themes/objections), generated
// by the backend after each scrape/fetch run - see backend
// src/lib/contentInsights.ts. Shared across Instagram/YouTube/Newsletter,
// each just points at its own read endpoint.
export function AiInsightCard({ endpoint, heading = "Analiza AI" }: { endpoint: string; heading?: string }) {
  const [insight, setInsight] = useState<InsightResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<InsightResponse>(endpoint)
      .then((res) => {
        if (!cancelled) setInsight(res);
      })
      .catch(() => {
        if (!cancelled) setError("Nie udało się pobrać analizy.");
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  return (
    <section className="card">
      <h2>{heading}</h2>
      {error && <p className="error-text">{error}</p>}
      {!insight && !error && <p className="hint-text">Ładowanie…</p>}
      {insight?.status === "pending" && <p className="card-muted-text">{insight.message}</p>}
      {insight?.status === "ok" && (
        <>
          <p className="analysis-text">{insight.content}</p>
          {insight.createdAt && (
            <p className="hint-text" style={{ marginTop: 8 }}>
              Wygenerowano: {new Date(insight.createdAt).toLocaleString("pl-PL")}
            </p>
          )}
        </>
      )}
    </section>
  );
}
