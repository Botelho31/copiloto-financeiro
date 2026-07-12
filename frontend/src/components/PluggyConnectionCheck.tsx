import { useTranslation } from "react-i18next";
import { FiCheck, FiX } from "react-icons/fi";
import { useTestPluggyConnection } from "../hooks/useUsers";

// A small on-demand check for an already-saved person — Pluggy credentials
// can be rotated or revoked on their end without this app ever finding out
// until the next sync fails, so this lets you check "is this still good"
// without waiting for that.
export function PluggyConnectionCheck(props: { userId: number; hasCredentials: boolean }) {
  const { t } = useTranslation("config");
  const testConnection = useTestPluggyConnection();

  if (!props.hasCredentials) return null;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        className="secondary icon"
        title={t("table.testConnection")}
        disabled={testConnection.isPending}
        onClick={() => testConnection.mutate({ userId: props.userId })}
      >
        <FiCheck />
      </button>
      {testConnection.data &&
        (testConnection.data.ok ? (
          <span title={t("table.connectionOk")} style={{ color: "var(--accent)" }}>
            <FiCheck />
          </span>
        ) : (
          <span title={testConnection.data.error} style={{ color: "var(--danger)" }}>
            <FiX /> {t("table.connectionFailed")}
          </span>
        ))}
    </span>
  );
}
