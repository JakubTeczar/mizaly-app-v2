import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { SocialAccount } from "@mizaly/shared";
import { apiClient, ApiError } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import { platformLabel } from "../lib/platformLabels";

interface PlatformsResponse {
  platforms: string[];
}

export function KontaPage() {
  const { user, logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const loadAccounts = () => {
    setIsLoading(true);
    setLoadError(null);
    Promise.all([
      apiClient.get<SocialAccount[]>("/api/social-accounts"),
      apiClient.get<PlatformsResponse>("/api/social-accounts/platforms"),
    ])
      .then(([accountsRes, platformsRes]) => {
        setAccounts(accountsRes);
        setPlatforms(platformsRes.platforms);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Nie udało się pobrać kont."))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After the browser bounces to Zernio and back, react to ?connected=1/0 and
  // then strip those params so a page refresh doesn't re-show the banner.
  const connected = searchParams.get("connected");
  useEffect(() => {
    if (connected === null) return;
    if (connected === "1") loadAccounts();
    const next = new URLSearchParams(searchParams);
    next.delete("connected");
    next.delete("platform");
    next.delete("error");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const handleConnect = async (platform: string) => {
    setConnectError(null);
    setConnectingPlatform(platform);
    try {
      const { authUrl } = await apiClient.post<{ authUrl: string }>("/api/social-accounts/connect", { platform });
      window.location.href = authUrl;
    } catch (err) {
      setConnectError(err instanceof ApiError ? err.message : "Nie udało się rozpocząć łączenia konta.");
      setConnectingPlatform(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    const previous = accounts;
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    try {
      await apiClient.del(`/api/social-accounts/${id}`);
    } catch {
      setAccounts(previous);
    }
  };

  const connectedPlatformSet = new Set(accounts.map((a) => a.platform));

  return (
    <div>
      <h1 className="page-title">Konta social media</h1>

      {connected === "1" && <p className="hint-text success">Konto zostało połączone.</p>}
      {connected === "0" && <p className="error-text">Nie udało się połączyć konta. Spróbuj ponownie.</p>}

      {isLoading && <p className="hint-text">Ładowanie…</p>}
      {loadError && <p className="error-text">{loadError}</p>}

      {!isLoading && !loadError && (
        <>
          <section className="card">
            <h2>Połączone konta</h2>
            {accounts.length === 0 && <p className="card-muted-text">Nie masz jeszcze podłączonych kont.</p>}
            <div className="list">
              {accounts.map((account) => {
                const label = platformLabel(account.platform);
                return (
                  <div key={account.id} className="list-item">
                    <p style={{ margin: "0 0 6px" }}>
                      <strong>{label}</strong>: {account.displayName}
                    </p>
                    <button type="button" className="btn btn-danger btn-small" onClick={() => handleDisconnect(account.id)}>
                      Odłącz
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card">
            <h2>Połącz nowe konto</h2>
            <p className="card-muted-text">
              Wybierz platformę. Zostaniesz przekierowany do logowania i autoryzacji dostępu.
            </p>
            {connectError && <p className="error-text">{connectError}</p>}
            <div className="list">
              {platforms.map((platform) => {
                const label = platformLabel(platform);
                const alreadyConnected = connectedPlatformSet.has(platform as any);
                return (
                  <button
                    key={platform}
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginBottom: 8 }}
                    disabled={connectingPlatform !== null || alreadyConnected}
                    onClick={() => handleConnect(platform)}
                  >
                    {alreadyConnected ? `${label} (połączono)` : connectingPlatform === platform ? "Przekierowanie…" : `Połącz ${label}`}
                  </button>
                );
              })}
            </div>
          </section>
        </>
      )}

      <section className="card">
        <h2>Twoje konto</h2>
        {user && <p className="card-muted-text">Zalogowano jako {user.email}</p>}
        <button type="button" className="btn btn-secondary" style={{ marginTop: 12 }} onClick={logout}>
          Wyloguj
        </button>
      </section>
    </div>
  );
}
