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
  const [pushoverAppToken, setPushoverAppToken] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [saved, setSaved] = useState(false);

  // Resyncs the buffer once appConfig loads/changes server-side — secrets
  // (pushoverAppToken, smtpPass) are never sent back, so those two inputs
  // stay blank ("leave unchanged" on submit) rather than resyncing.
  useEffect(() => {
    if (!appConfig) return;
    setCronSchedule(appConfig.cronSchedule);
    setMinBuffer(String(appConfig.minBuffer));
    setLargeTransactionThreshold(String(appConfig.largeTransactionThreshold));
    setSmtpHost(appConfig.smtpHost ?? "");
    setSmtpPort(String(appConfig.smtpPort));
    setSmtpUser(appConfig.smtpUser ?? "");
    setSmtpFrom(appConfig.smtpFrom ?? "");
  }, [appConfig]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const input: AppConfigUpdateInput = {
      cronSchedule,
      minBuffer: Number(minBuffer),
      largeTransactionThreshold: Number(largeTransactionThreshold),
      smtpHost,
      smtpPort: Number(smtpPort),
      smtpUser,
      smtpFrom,
    };
    if (pushoverAppToken.trim()) input.pushoverAppToken = pushoverAppToken.trim();
    if (smtpPass.trim()) input.smtpPass = smtpPass.trim();
    setSaved(false);
    updateAppConfig.mutate(input, {
      onSuccess: () => {
        setPushoverAppToken("");
        setSmtpPass("");
        setSaved(true);
      },
    });
  }

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="card">
        <h2>{t("tabs.appSettings")}</h2>
        <p className="muted">{t("appSettings.language")}</p>
        <LanguageSwitcher />
      </div>

      <form className="card grid" style={{ gap: 16 }} onSubmit={submit}>
        <div>
          <h2>{t("appSettings.sync.title")}</h2>
          <p className="muted">{t("appSettings.sync.subtitle")}</p>
        </div>
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}
        >
          <label>
            {t("appSettings.sync.cronSchedule")}
            <input
              type="text"
              value={cronSchedule}
              onChange={(e) => setCronSchedule(e.target.value)}
              placeholder="0 6 * * *"
            />
          </label>
          <label>
            {t("appSettings.sync.minBuffer")}
            <input
              type="number"
              step="0.01"
              value={minBuffer}
              onChange={(e) => setMinBuffer(e.target.value)}
            />
          </label>
          <label>
            {t("appSettings.sync.largeTransactionThreshold")}
            <input
              type="number"
              step="0.01"
              value={largeTransactionThreshold}
              onChange={(e) => setLargeTransactionThreshold(e.target.value)}
            />
          </label>
        </div>

        <div>
          <h2>{t("appSettings.pushover.title")}</h2>
          <p className="muted">{t("appSettings.pushover.subtitle")}</p>
        </div>
        <label>
          {t("appSettings.pushover.appToken")}
          <input
            type="password"
            value={pushoverAppToken}
            onChange={(e) => setPushoverAppToken(e.target.value)}
            placeholder={
              appConfig?.hasPushoverAppToken ? t("form.unchangedPlaceholder") : undefined
            }
          />
        </label>

        <div>
          <h2>{t("appSettings.smtp.title")}</h2>
          <p className="muted">{t("appSettings.smtp.subtitle")}</p>
        </div>
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}
        >
          <label>
            {t("appSettings.smtp.host")}
            <input type="text" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
          </label>
          <label>
            {t("appSettings.smtp.port")}
            <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
          </label>
          <label>
            {t("appSettings.smtp.user")}
            <input type="text" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
          </label>
          <label>
            {t("appSettings.smtp.pass")}
            <input
              type="password"
              value={smtpPass}
              onChange={(e) => setSmtpPass(e.target.value)}
              placeholder={appConfig?.hasSmtpPass ? t("form.unchangedPlaceholder") : undefined}
            />
          </label>
          <label>
            {t("appSettings.smtp.from")}
            <input type="text" value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} />
          </label>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button type="submit" disabled={updateAppConfig.isPending}>
            {t("form.save")}
          </button>
          {saved && !updateAppConfig.isPending && (
            <span
              style={{
                color: "var(--accent)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <FiCheck /> {t("appSettings.saved")}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
