import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
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

function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  return (
    <div className="toggle-group" aria-label={t("language.en") + " / " + t("language.pt")}>
      <button
        type="button"
        className={i18n.resolvedLanguage === "pt" ? "active" : undefined}
        onClick={() => void i18n.changeLanguage("pt")}
      >
        PT
      </button>
      <button
        type="button"
        className={i18n.resolvedLanguage === "en" ? "active" : undefined}
        onClick={() => void i18n.changeLanguage("en")}
      >
        EN
      </button>
    </div>
  );
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
        <LanguageSwitcher />
        <form
          className="logout-form"
          onSubmit={(e) => {
            e.preventDefault();
            void logout();
          }}
        >
          <button type="submit" className="link-button">
            {t("logout")}
          </button>
        </form>
      </header>
      <main>{children}</main>
    </div>
  );
}
