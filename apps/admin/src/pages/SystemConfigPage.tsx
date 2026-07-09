import { useEffect, useState } from "react";
import { apiClient, ApiError } from "../lib/apiClient";

interface SystemStatus {
  zernioConfigured: boolean;
  openaiConfigured: boolean;
}

function StatusBadge({ configured }: { configured: boolean }) {
  return configured ? (
    <span className="badge badge--ok">✅ Skonfigurowano</span>
  ) : (
    <span className="badge badge--error">❌ Brak klucza</span>
  );
}

export default function SystemConfigPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await apiClient.get<SystemStatus>("/api/admin/system/status");
        if (!cancelled) setStatus(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Nie udało się pobrać statusu systemu.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1>Konfiguracja systemu</h1>
      <p className="page-subtitle">Status globalnych integracji wykorzystywanych przez Mizaly.</p>

      {isLoading && <p>Ładowanie…</p>}
      {error && <div className="form-error">{error}</div>}

      {status && (
        <div className="status-list">
          <div className="status-row">
            <span className="status-row__name">Zernio API</span>
            <StatusBadge configured={status.zernioConfigured} />
          </div>
          <div className="status-row">
            <span className="status-row__name">OpenAI API</span>
            <StatusBadge configured={status.openaiConfigured} />
          </div>
        </div>
      )}

      <section className="wip-section">
        <h2>🚧 Monitoring webhooków — w budowie</h2>
        <p>
          Podgląd statusu i historii webhooków od Zernio pojawi się w kolejnym etapie prac, po
          skonfigurowaniu odbiornika webhooków w backendzie.
        </p>
      </section>
    </div>
  );
}
