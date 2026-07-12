import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiBell, FiCheck } from "react-icons/fi";
import { useMarkNotificationRead, useNotifications } from "../hooks/useNotifications";
import { formatDate } from "../lib/format";

const SEVERITY_COLOR: Record<string, string> = {
  info: "var(--text-muted)",
  warning: "var(--gold)",
  critical: "var(--danger)",
};

export function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data: notifications } = useNotifications();
  const markRead = useMarkNotificationRead();
  const containerRef = useRef<HTMLDivElement>(null);

  const unread = (notifications ?? []).filter((n) => n.read_at == null);

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

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="secondary icon"
        title={t("notifications.title")}
        onClick={() => setOpen((o) => !o)}
        style={{ position: "relative" }}
      >
        <FiBell />
        {unread.length > 0 && (
          <span
            className="badge"
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              background: "var(--danger)",
              color: "var(--paper)",
              borderRadius: "50%",
              minWidth: 16,
              height: 16,
              fontSize: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            zIndex: 20,
            background: "var(--ink-raised)",
            border: "1px solid var(--rule)",
            borderRadius: 3,
            marginTop: 4,
            width: 340,
            maxHeight: 400,
            overflowY: "auto",
          }}
        >
          {(notifications ?? []).length === 0 ? (
            <p className="muted" style={{ padding: 12, margin: 0 }}>
              {t("notifications.empty")}
            </p>
          ) : (
            (notifications ?? []).map((n) => (
              <div
                key={n.id}
                style={{
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--rule)",
                  opacity: n.read_at ? 0.6 : 1,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span
                    style={{ color: SEVERITY_COLOR[n.severity], fontWeight: 600, fontSize: 13 }}
                  >
                    {n.title}
                  </span>
                  {!n.read_at && (
                    <button
                      type="button"
                      className="link-button"
                      title={t("notifications.markRead")}
                      onClick={() => markRead.mutate(n.id)}
                    >
                      <FiCheck />
                    </button>
                  )}
                </div>
                <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                  {n.body}
                </p>
                <p className="muted" style={{ margin: "4px 0 0", fontSize: 11 }}>
                  {formatDate(n.created_at)}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
