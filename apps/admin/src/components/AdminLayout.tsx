import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/authContext";

export default function AdminLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar__brand">Mizaly Admin</div>
        <nav className="admin-sidebar__nav">
          <NavLink to="/dashboard" className={({ isActive }) => (isActive ? "active" : "")}>
            📊 Dashboard
          </NavLink>
          <NavLink to="/organizations" className={({ isActive }) => (isActive ? "active" : "")}>
            👥 Organizacje i użytkownicy
          </NavLink>
          <NavLink to="/system" className={({ isActive }) => (isActive ? "active" : "")}>
            ⚙️ Konfiguracja systemu
          </NavLink>
        </nav>
        <button type="button" className="admin-sidebar__logout" onClick={handleLogout}>
          Wyloguj
        </button>
      </aside>
      <main className="admin-content">
        <Outlet />
      </main>
    </div>
  );
}
