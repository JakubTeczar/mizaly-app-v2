import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { User } from "@mizaly/shared";
import {
  apiClient,
  getStoredToken,
  setStoredToken,
  setStoredRefreshToken,
  SESSION_EXPIRED_EVENT,
} from "./apiClient";

const USER_STORAGE_KEY = "mizaly_user";

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

interface AuthContextValue {
  accessToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (organizationName: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<User | null>(() => readStoredUser());

  useEffect(() => {
    setStoredToken(accessToken);
  }, [accessToken]);

  useEffect(() => {
    try {
      if (user) {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(USER_STORAGE_KEY);
      }
    } catch {
      // ignore storage failures
    }
  }, [user]);

  const login = async (email: string, password: string) => {
    const data = await apiClient.post<AuthResponse>("/api/auth/login", { email, password });
    setStoredRefreshToken(data.refreshToken);
    setAccessToken(data.accessToken);
    setUser(data.user);
  };

  const register = async (organizationName: string, email: string, password: string) => {
    const data = await apiClient.post<AuthResponse>("/api/auth/register", {
      organizationName,
      email,
      password,
    });
    setStoredRefreshToken(data.refreshToken);
    setAccessToken(data.accessToken);
    setUser(data.user);
  };

  const logout = () => {
    setStoredRefreshToken(null);
    setAccessToken(null);
    setUser(null);
  };

  // Fired by apiClient when both the access token and refresh token have
  // stopped working (refresh token expired/revoked) - log out so the user
  // lands back on /login instead of seeing repeated "invalid token" errors.
  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, logout);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, logout);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      user,
      isAuthenticated: Boolean(accessToken),
      login,
      register,
      logout,
    }),
    [accessToken, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

/** Redirects to /login when there is no authenticated user. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
