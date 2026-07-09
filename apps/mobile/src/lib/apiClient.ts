// Small fetch wrapper for talking to the Mizaly backend REST API.
// Reads base URL from VITE_API_URL and attaches the bearer token from
// localStorage (kept in sync by AuthProvider) when present.
//
// Access tokens are short-lived (15 min, see backend src/lib/jwt.ts). On a
// 401 we transparently try the refresh token once before giving up, so an
// active session doesn't get kicked to the login screen every 15 minutes.

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const TOKEN_STORAGE_KEY = "mizaly_access_token";
const REFRESH_TOKEN_STORAGE_KEY = "mizaly_refresh_token";

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable (private mode etc.), ignore, session-only auth.
  }
}

export function getStoredRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredRefreshToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Fired when the refresh token is also invalid/expired, so AuthProvider (a
// plain module can't use the React context directly) can log the user out
// and redirect to /login.
const SESSION_EXPIRED_EVENT = "mizaly:session-expired";

// Multiple requests can 401 around the same time (e.g. a page firing several
// fetches at once) - share one in-flight refresh instead of racing several.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return null;

  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        return data?.accessToken ?? null;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

async function doFetch(path: string, options: RequestInit, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  return fetch(`${API_URL}${path}`, { ...options, headers });
}

async function request<T>(path: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const token = getStoredToken();
  let response = await doFetch(path, options, token);

  if (response.status === 401 && !isRetry && getStoredRefreshToken()) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      setStoredToken(newToken);
      return request<T>(path, options, true);
    }
    setStoredToken(null);
    setStoredRefreshToken(null);
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const message =
      (data && (data.message || data.error)) || `Błąd żądania (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return data as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export { API_URL, SESSION_EXPIRED_EVENT };
