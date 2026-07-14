import { useEffect, useState } from "react";
import type { InspirationItem, WatchedInstagramAccount } from "@mizaly/shared";
import { apiClient, ApiError } from "../../lib/apiClient";
import { TrendsFeed } from "./TrendsFeed";
import { AiInsightCard } from "./AiInsightCard";
import { WatchlistManager } from "./WatchlistManager";

interface WipResponse {
  status: string;
  message: string;
}

function WipCard({ title, endpoint }: { title: string; endpoint: string }) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<WipResponse>(endpoint)
      .then((res) => {
        if (!cancelled) setMessage(res.message);
      })
      .catch(() => {
        if (!cancelled) setMessage("Ta funkcja jest w budowie.");
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="card-muted-text">{message ?? "Ładowanie…"}</p>
    </section>
  );
}

export function InstagramSection({ onSaved }: { onSaved: (item: InspirationItem) => void }) {
  const [accounts, setAccounts] = useState<WatchedInstagramAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<WatchedInstagramAccount[]>("/api/instagram-accounts")
      .then(setAccounts)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Nie udało się pobrać kont."))
      .finally(() => setIsLoading(false));
  }, []);

  const handleAdd = async (username: string) => {
    const created = await apiClient.post<WatchedInstagramAccount>("/api/instagram-accounts", { username });
    setAccounts((prev) => [...prev, created]);
  };

  const handleRemove = async (id: string) => {
    const previous = accounts;
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    try {
      await apiClient.del(`/api/instagram-accounts/${id}`);
    } catch {
      setAccounts(previous);
    }
  };

  return (
    <>
      <WatchlistManager
        title="Obserwowane konta"
        description="Skąd pobieramy inspiracje z Instagrama. Zmiany obejmie kolejne pobranie danych."
        placeholder="np. gymshark"
        items={accounts.map((a) => ({ id: a.id, label: `@${a.username}` }))}
        isLoading={isLoading}
        loadError={loadError}
        onAdd={handleAdd}
        onRemove={handleRemove}
      />
      <AiInsightCard endpoint="/api/inspiration/analysis" />
      <TrendsFeed onSaved={onSaved} />
      <WipCard title="Analiza konkurencji" endpoint="/api/inspiration/competitors" />
    </>
  );
}
