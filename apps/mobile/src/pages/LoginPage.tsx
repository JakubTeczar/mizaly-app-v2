import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/authContext";
import { ApiError } from "../lib/apiClient";

type Mode = "login" | "register";

export function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("login");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(organizationName, email, password);
      }
      navigate("/tworzenie", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Coś poszło nie tak. Spróbuj ponownie.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <img className="login-logo" src="/logo.png" alt="Mizaly" />
      <p className="login-subtitle">Zarządzaj social mediami swojej firmy z telefonu</p>

      <form onSubmit={handleSubmit}>
        {mode === "register" && (
          <div className="field">
            <label htmlFor="organizationName">Nazwa firmy</label>
            <input
              id="organizationName"
              type="text"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              required
              placeholder="Np. Kwiaciarnia Zosia"
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="ty@firma.pl"
          />
        </div>

        <div className="field">
          <label htmlFor="password">Hasło</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={6}
          />
        </div>

        {error && <p className="error-text">{error}</p>}

        <button type="submit" className="btn" disabled={isSubmitting}>
          {isSubmitting
            ? "Chwileczkę…"
            : mode === "login"
              ? "Zaloguj się"
              : "Zarejestruj się"}
        </button>
      </form>

      <div className="login-toggle">
        {mode === "login" ? (
          <>
            Nie masz konta?{" "}
            <button type="button" onClick={() => setMode("register")}>
              Zarejestruj się
            </button>
          </>
        ) : (
          <>
            Masz już konto?{" "}
            <button type="button" onClick={() => setMode("login")}>
              Zaloguj się
            </button>
          </>
        )}
      </div>
    </div>
  );
}
