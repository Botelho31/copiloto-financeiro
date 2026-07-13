import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FiLogOut, FiSettings } from "react-icons/fi";
import { Link, useLocation } from "react-router-dom";
import { NotificationBell } from "./NotificationBell";
import { PersonSwitcher } from "./PersonSwitcher";
import { logout } from "../lib/api";

function useNavLinks() {
  const { t } = useTranslation();
  return [
    { to: "/", label: t("nav.dashboard") },
    { to: "/transactions", label: t("nav.transactions") },
    { to: "/bills", label: t("nav.bills") },
    { to: "/debts", label: t("nav.debts") },
    { to: "/projections", label: t("nav.projections") },
  ];
}

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { t } = useTranslation();
  const navLinks = useNavLinks();

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand">{t("brand")}</span>
        <nav>
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={location.pathname === link.to ? "active" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <PersonSwitcher />
        <NotificationBell />
        <Link
          to="/config"
          className={"secondary icon" + (location.pathname.startsWith("/config") ? " active" : "")}
          title={t("nav.config")}
        >
          <FiSettings />
        </Link>
        <form
          className="logout-form"
          onSubmit={(e) => {
            e.preventDefault();
            void logout();
          }}
        >
          <button type="submit" className="secondary icon" title={t("logout")}>
            <FiLogOut />
          </button>
        </form>
      </header>
      <main>{children}</main>
    </div>
  );
}
