import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ColorSwatch } from "../components/ColorSwatch";
import { NotificationProviders } from "../components/NotificationProviders";
import { ProviderSetup } from "../components/ProviderSetup";
import { useUsers } from "../hooks/useUsers";

export function ConfigNotifications() {
  const { t } = useTranslation("config");
  const { data: users } = useUsers();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (selectedId == null && users && users.length > 0) setSelectedId(users[0]!.id);
  }, [users, selectedId]);

  return (
    <div>
      <header className="config-header">
        <div>
          <h2>{t("notifications.title")}</h2>
          <p className="muted">{t("notifications.description")}</p>
        </div>
      </header>

      <div className="grid" style={{ gap: 24 }}>
        <div className="card">
          {(users ?? []).length === 0 ? (
            <p className="muted">{t("empty")}</p>
          ) : (
            <>
              <div className="toggle-group" style={{ marginBottom: 16 }}>
                {(users ?? []).map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className={selectedId === u.id ? "active" : undefined}
                    onClick={() => setSelectedId(u.id)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <ColorSwatch color={u.color} />
                    {u.name}
                  </button>
                ))}
              </div>
              {selectedId != null && <NotificationProviders userId={selectedId} />}
            </>
          )}
        </div>

        <ProviderSetup />
      </div>
    </div>
  );
}
