import { useState, type FormEvent } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";
import { useAuth } from "../lib/authContext";
import { ApiError } from "../lib/apiClient";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      const from = (location.state as { from?: Location } | null)?.from;
      const redirectTo = from ? `${from.pathname}${from.search ?? ""}` : "/dashboard";
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nie udało się zalogować. Spróbuj ponownie.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Mizaly — Panel administracyjny</h1>
        <p className="login-card__subtitle">Zaloguj się jako administrator, aby kontynuować.</p>

        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />

        <label htmlFor="password">Hasło</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && <div className="form-error">{error}</div>}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Logowanie…" : "Zaloguj się"}
        </button>
      </form>
    </div>
  );
}
