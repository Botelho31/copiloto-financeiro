import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ColorSwatch } from "../components/ColorSwatch";
import { NotificationProviders } from "../components/NotificationProviders";
import {
  NotificationRuleDefaults,
  NotificationRuleOverrides,
} from "../components/NotificationRules";
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
        <NotificationRuleDefaults />

        {(users ?? []).length === 0 ? (
          <div className="card">
            <p className="muted">{t("empty")}</p>
          </div>
        ) : (
          <>
            <div className="card">
              <div className="toggle-group">
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
            </div>

            {selectedId != null && (
              <>
                <div className="card">
                  <h2>{t("notifications.rules.perPersonTitle")}</h2>
                  <p className="muted">{t("notifications.rules.perPersonSubtitle")}</p>
                  <div style={{ marginTop: 16 }}>
                    <NotificationRuleOverrides userId={selectedId} />
                  </div>
                </div>

                <div className="card">
                  <h2>{t("notifications.destinationsTitle")}</h2>
                  <p className="muted">{t("notifications.destinationsSubtitle")}</p>
                  <div style={{ marginTop: 16 }}>
                    <NotificationProviders userId={selectedId} />
                  </div>
                </div>
              </>
            )}
          </>
        )}

        <ProviderSetup />
      </div>
    </div>
  );
}
