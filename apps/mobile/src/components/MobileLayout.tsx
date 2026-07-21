import { NavLink, Outlet } from "react-router-dom";
import { IconAnalityke, IconInspiracje, IconTworzenie, IconWiadomosci } from "./NavIcons";
import type { ComponentType } from "react";
import { FEATURE_FLAGS } from "../lib/featureFlags";

interface TabDef {
  to: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  comingSoon?: boolean;
  /** Funkcja już dostępna, ale wciąż w fazie testów - widoczna jako "Beta", w odróżnieniu od zablokowanego "Wkrótce". */
  beta?: boolean;
}

const TABS: TabDef[] = [
  { to: "/inspiracje", label: "Inspiracje", Icon: IconInspiracje },
  { to: "/tworzenie", label: "Tworzenie", Icon: IconTworzenie, beta: true },
  { to: "/analityke", label: "Analitykę", Icon: IconAnalityke },
  { to: "/wiadomosci", label: "Wiadomości", Icon: IconWiadomosci, comingSoon: FEATURE_FLAGS.wiadomosci },
];

export function MobileLayout() {
  return (
    <div className="mobile-layout">
      <header className="top-bar">
        <img className="top-bar-logo" src="/logo-full.png" alt="Mizaly" />
        <NavLink
          to="/konta"
          className={({ isActive }) => `top-bar-action${isActive ? " active" : ""}`}
        >
          Konta
        </NavLink>
      </header>
      <main className="mobile-content">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Główna nawigacja">
        {TABS.map((tab) =>
          tab.comingSoon ? (
            <span key={tab.to} className="bottom-nav-item bottom-nav-item--locked" aria-disabled="true">
              <tab.Icon className="bottom-nav-icon" />
              <span className="bottom-nav-label">{tab.label}</span>
              <span className="badge-coming-soon badge-coming-soon--corner">Wkrótce</span>
            </span>
          ) : (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}
            >
              {tab.beta && <span className="badge-beta badge-beta--tab">Beta</span>}
              <tab.Icon className="bottom-nav-icon" />
              <span className="bottom-nav-label">{tab.label}</span>
            </NavLink>
          )
        )}
      </nav>
    </div>
  );
}
