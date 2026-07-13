import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiChevronDown } from "react-icons/fi";
import { useUsers } from "../hooks/useUsers";
import { usePersonScope } from "../lib/personScope";
import { ColorSwatch } from "./ColorSwatch";

// Custom dropdown (not a native <select>) so each option can carry the
// person's own color dot, matching CategorySelect's popover shape.
export function PersonSwitcher() {
  const { t } = useTranslation();
  const { data: users } = useUsers();
  const { activeUserId, setActiveUserId } = usePersonScope();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const active = (users ?? []).find((u) => u.id === activeUserId);

  function select(id: number | null) {
    setActiveUserId(id);
    setOpen(false);
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="secondary"
        aria-label={t("nav.person")}
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 8 }}
      >
        {active ? <ColorSwatch color={active.color} /> : null}
        {active ? active.name : t("nav.household")}
        <FiChevronDown size={13} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 20,
            background: "var(--ink-raised)",
            border: "1px solid var(--rule)",
            borderRadius: 3,
            marginTop: 4,
            minWidth: 160,
            overflow: "hidden",
          }}
        >
          <div
            onClick={() => select(null)}
            style={{
              padding: "8px 12px",
              cursor: "pointer",
              fontWeight: activeUserId == null ? 600 : 400,
              color: activeUserId == null ? "var(--paper)" : "var(--text-muted)",
            }}
          >
            {t("nav.household")}
          </div>
          {(users ?? []).map((u) => (
            <div
              key={u.id}
              onClick={() => select(u.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                cursor: "pointer",
                fontWeight: activeUserId === u.id ? 600 : 400,
                color: activeUserId === u.id ? "var(--paper)" : "var(--text-muted)",
              }}
            >
              <ColorSwatch color={u.color} />
              {u.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
