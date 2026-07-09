import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { apiClient, ADMIN_TOKEN_STORAGE_KEY, getStoredAdminToken } from "./apiClient";

interface LoginResponse {
  accessToken: string;
}

interface AuthContextValue {
  accessToken: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(() => getStoredAdminToken());

  const login = useCallback(async (email: string, password: string) => {
    const { accessToken: token } = await apiClient.post<LoginResponse>("/api/admin/auth/login", {
      email,
      password,
    });
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    setAccessToken(token);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    setAccessToken(null);
  }, []);

  const value = useMemo(
    () => ({
      accessToken,
      isAuthenticated: Boolean(accessToken),
      login,
      logout,
    }),
    [accessToken, login, logout]
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

// Wraps routes that require an authenticated admin; redirects to /login
// (preserving the intended destination) when there is no access token.
export function RequireAdminAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
