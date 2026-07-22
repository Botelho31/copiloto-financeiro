import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";

const TABS = [
  { to: "/config/app-settings", end: false, key: "appSettings" },
  { to: "/config", end: true, key: "people" },
  { to: "/config/notifications", end: false, key: "notifications" },
  { to: "/config/categories", end: false, key: "categories" },
] as const;

export function ConfigPage() {
  const { t } = useTranslation("config");

  return (
    <div className="config-shell">
      <nav>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => (isActive ? "active" : undefined)}
          >
            {t(`tabs.${tab.key}`)}
          </NavLink>
        ))}
      </nav>
      <div className="config-content">
        <Outlet />
      </div>
    </div>
  );
}
