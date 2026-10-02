import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCheck } from "react-icons/fi";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { type AppConfigUpdateInput, useAppConfig, useUpdateAppConfig } from "../hooks/useAppConfig";

export function ConfigAppSettings() {
  const { t } = useTranslation("config");
  const { data: appConfig } = useAppConfig();
  const updateAppConfig = useUpdateAppConfig();

  const [minBuffer, setMinBuffer] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!appConfig) return;
    setMinBuffer(String(appConfig.minBuffer));
  }, [appConfig]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const input: AppConfigUpdateInput = {
      minBuffer: Number(minBuffer),
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
            <h2>{t("appSettings.thresholds.title")}</h2>
            <p className="muted">{t("appSettings.thresholds.subtitle")}</p>
          </div>
          <div className="form-grid">
            <label>
              {t("appSettings.thresholds.minBuffer")}
              <input
                type="number"
                step="0.01"
                value={minBuffer}
                onChange={(e) => setMinBuffer(e.target.value)}
              />
              <span className="hint">{t("appSettings.thresholds.minBufferHint")}</span>
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
