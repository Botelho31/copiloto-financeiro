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
    <div>
      <header className="config-header">
        <div>
          <h2>{t("title")}</h2>
          <p className="muted">{t("subtitle")}</p>
        </div>
        <Link to="/config/users/new" className="button">
          <FiPlus /> {t("addForm.submit")}
        </Link>
      </header>

      {error && (
        <p className="error" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}

      <div className="card">
        {(users ?? []).length === 0 ? (
          <p className="muted">{t("empty")}</p>
        ) : (
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
                      <PluggyConnectionCheck
                        userId={u.id}
                        hasCredentials={u.hasPluggyCredentials}
                      />
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span className="row-actions">
                      <button
                        className="secondary icon"
                        title={t("table.syncNow")}
                        disabled={!u.hasPluggyCredentials || triggerSync.isPending}
                        onClick={() => triggerSync.mutate(u.id)}
                      >
                        <FiRefreshCw />
                      </button>
                      <Link
                        to={`/config/users/${u.id}`}
                        className="secondary icon"
                        title={t("table.edit")}
                      >
                        <FiEdit2 />
                      </Link>
                      <button
                        className="danger icon"
                        title={t("table.remove")}
                        onClick={() => {
                          setError(null);
                          deleteUser.mutate(u.id, {
                            onError: (err) =>
                              setError(err instanceof Error ? err.message : String(err)),
                          });
                        }}
                      >
                        <FiTrash2 />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
