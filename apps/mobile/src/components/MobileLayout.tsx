import { NavLink, Outlet } from "react-router-dom";
import { IconAnalityke, IconInspiracje, IconTworzenie, IconWiadomosci } from "./NavIcons";
import type { ComponentType } from "react";

interface TabDef {
  to: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}

const TABS: TabDef[] = [
  { to: "/inspiracje", label: "Inspiracje", Icon: IconInspiracje },
  { to: "/tworzenie", label: "Tworzenie", Icon: IconTworzenie },
  { to: "/analityke", label: "Analitykę", Icon: IconAnalityke },
  { to: "/wiadomosci", label: "Wiadomości", Icon: IconWiadomosci },
];

export function MobileLayout() {
  return (
    <div className="mobile-layout">
      <header className="top-bar">
        <img className="top-bar-logo" src="/logo.png" alt="Mizaly" />
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
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}
          >
            <tab.Icon className="bottom-nav-icon" />
            <span className="bottom-nav-label">{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
