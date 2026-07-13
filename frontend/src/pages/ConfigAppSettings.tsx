import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCheck } from "react-icons/fi";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { type AppConfigUpdateInput, useAppConfig, useUpdateAppConfig } from "../hooks/useAppConfig";

export function ConfigAppSettings() {
  const { t } = useTranslation("config");
  const { data: appConfig } = useAppConfig();
  const updateAppConfig = useUpdateAppConfig();

  const [cronSchedule, setCronSchedule] = useState("");
  const [minBuffer, setMinBuffer] = useState("");
  const [largeTransactionThreshold, setLargeTransactionThreshold] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!appConfig) return;
    setCronSchedule(appConfig.cronSchedule);
    setMinBuffer(String(appConfig.minBuffer));
    setLargeTransactionThreshold(String(appConfig.largeTransactionThreshold));
  }, [appConfig]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const input: AppConfigUpdateInput = {
      cronSchedule,
      minBuffer: Number(minBuffer),
      largeTransactionThreshold: Number(largeTransactionThreshold),
    };
    setSaved(false);
    updateAppConfig.mutate(input, { onSuccess: () => setSaved(true) });
  }

  return (
    <div>
      <header className="config-header">
        <div>
          <h2>{t("tabs.appSettings")}</h2>
          <p className="muted">{t("appSettings.subtitle")}</p>
        </div>
      </header>

      <div className="grid" style={{ gap: 24 }}>
        <div className="card">
          <h2>{t("appSettings.language")}</h2>
          <LanguageSwitcher />
        </div>

        <form className="card grid" style={{ gap: 16 }} onSubmit={submit}>
          <div className="card-intro">
            <h2>{t("appSettings.sync.title")}</h2>
            <p className="muted">{t("appSettings.sync.subtitle")}</p>
          </div>
          <div className="form-grid">
            <label>
              {t("appSettings.sync.cronSchedule")}
              <input
                type="text"
                value={cronSchedule}
                onChange={(e) => setCronSchedule(e.target.value)}
                placeholder="0 6 * * *"
              />
              <span className="hint">{t("appSettings.sync.cronScheduleHint")}</span>
            </label>
            <label>
              {t("appSettings.sync.minBuffer")}
              <input
                type="number"
                step="0.01"
                value={minBuffer}
                onChange={(e) => setMinBuffer(e.target.value)}
              />
              <span className="hint">{t("appSettings.sync.minBufferHint")}</span>
            </label>
            <label>
              {t("appSettings.sync.largeTransactionThreshold")}
              <input
                type="number"
                step="0.01"
                value={largeTransactionThreshold}
                onChange={(e) => setLargeTransactionThreshold(e.target.value)}
              />
              <span className="hint">{t("appSettings.sync.largeTransactionThresholdHint")}</span>
            </label>
          </div>

          <div className="form-actions">
            <button type="submit" disabled={updateAppConfig.isPending}>
              {t("form.save")}
            </button>
            {saved && !updateAppConfig.isPending && (
              <span className="status-ok">
                <FiCheck /> {t("appSettings.saved")}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
