import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { logout } from "../lib/api";

const NAV_LINKS = [
  { to: "/", label: "Dashboard" },
  { to: "/transactions", label: "Transactions" },
  { to: "/bills", label: "Planned Payments" },
  { to: "/debts", label: "Debts" },
  { to: "/projections", label: "Projections" },
];

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand">Budget Tracker</span>
        <nav>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={location.pathname === link.to ? "active" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <form
          className="logout-form"
          onSubmit={(e) => {
            e.preventDefault();
            void logout();
          }}
        >
          <button type="submit" className="link-button">
            Log out
          </button>
        </form>
      </header>
      <main>{children}</main>
    </div>
  );
}
