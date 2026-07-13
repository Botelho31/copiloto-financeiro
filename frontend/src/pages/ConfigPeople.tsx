import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FiEdit2, FiPlus, FiRefreshCw, FiTrash2 } from "react-icons/fi";
import { Link } from "react-router-dom";
import { ColorSwatch } from "../components/ColorSwatch";
import { PluggyConnectionCheck } from "../components/PluggyConnectionCheck";
import { useTriggerSync } from "../hooks/useSync";
import { useDeleteUser, useUsers } from "../hooks/useUsers";

export function ConfigPeople() {
  const { t } = useTranslation("config");
  const { data: users } = useUsers();
  const deleteUser = useDeleteUser();
  const triggerSync = useTriggerSync();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2>{t("title")}</h2>
          <p className="muted">{t("subtitle")}</p>
        </div>
        <Link
          to="/config/users/new"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <FiPlus /> {t("addForm.submit")}
        </Link>
      </div>
      {error && (
        <p className="shortfall" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>{t("table.name")}</th>
            <th>{t("table.pluggy")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(users ?? []).map((u) => (
            <tr key={u.id}>
              <td>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <ColorSwatch color={u.color} size={12} />
                  {u.name}
                </span>
              </td>
              <td>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {u.hasPluggyCredentials ? (
                    <span className="badge">
                      {t("table.pluggyConnected", { count: u.pluggyItemIds.length })}
                    </span>
                  ) : (
                    <span className="muted">{t("table.pluggyNotConnected")}</span>
                  )}
                  <PluggyConnectionCheck userId={u.id} hasCredentials={u.hasPluggyCredentials} />
                </span>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button
                  className="secondary icon"
                  title={t("table.syncNow")}
                  disabled={!u.hasPluggyCredentials || triggerSync.isPending}
                  onClick={() => triggerSync.mutate(u.id)}
                >
                  <FiRefreshCw />
                </button>{" "}
                <Link to={`/config/users/${u.id}`} className="secondary icon">
                  <FiEdit2 />
                </Link>{" "}
                <button
                  className="danger icon"
                  title={t("table.remove")}
                  onClick={() => {
                    setError(null);
                    deleteUser.mutate(u.id, {
                      onError: (err) => setError(err instanceof Error ? err.message : String(err)),
                    });
                  }}
                >
                  <FiTrash2 />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(users ?? []).length === 0 && <p className="muted">{t("empty")}</p>}
    </div>
  );
}
