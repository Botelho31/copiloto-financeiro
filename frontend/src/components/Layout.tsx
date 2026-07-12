import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { useUsers } from "../hooks/useUsers";
import { logout } from "../lib/api";
import { usePersonScope } from "../lib/personScope";

function useNavLinks() {
  const { t } = useTranslation();
  return [
    { to: "/", label: t("nav.dashboard") },
    { to: "/transactions", label: t("nav.transactions") },
    { to: "/bills", label: t("nav.bills") },
    { to: "/debts", label: t("nav.debts") },
    { to: "/projections", label: t("nav.projections") },
    { to: "/household", label: t("nav.household") },
    { to: "/config", label: t("nav.config") },
  ];
}

function PersonSwitcher() {
  const { t } = useTranslation();
  const { data: users } = useUsers();
  const { activeUserId, setActiveUserId } = usePersonScope();

  return (
    <select
      aria-label={t("nav.person")}
      value={activeUserId ?? "household"}
      onChange={(e) =>
        setActiveUserId(e.target.value === "household" ? null : Number(e.target.value))
      }
    >
      <option value="household">{t("nav.household")}</option>
      {(users ?? []).map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );
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
        <PersonSwitcher />
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
