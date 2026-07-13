import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCheck, FiChevronDown, FiChevronRight } from "react-icons/fi";
import { type AppConfigUpdateInput, useAppConfig, useUpdateAppConfig } from "../hooks/useAppConfig";

// The app-wide credentials each provider needs to actually deliver anything
// (one Pushover app token, one SMTP relay for the whole deployment) — kept
// separate from each person's own destination (see NotificationProviders),
// but surfaced here rather than in App Settings since it's meaningless
// without a person's provider row to pair with.
export function ProviderSetup() {
  const { t } = useTranslation("config");
  const { data: appConfig } = useAppConfig();
  const updateAppConfig = useUpdateAppConfig();

  const [open, setOpen] = useState(false);
  const [pushoverAppToken, setPushoverAppToken] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!appConfig) return;
    setSmtpHost(appConfig.smtpHost ?? "");
    setSmtpPort(String(appConfig.smtpPort));
    setSmtpUser(appConfig.smtpUser ?? "");
    setSmtpFrom(appConfig.smtpFrom ?? "");
  }, [appConfig]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const input: AppConfigUpdateInput = {
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
    <div className="card">
      <button className="disclosure" onClick={() => setOpen((o) => !o)}>
        {open ? <FiChevronDown /> : <FiChevronRight />} {t("providerSetup.title")}
      </button>
      <p className="muted">{t("providerSetup.subtitle")}</p>
      {open && (
        <form className="grid" style={{ gap: 16, marginTop: 12 }} onSubmit={submit}>
          <div className="card-intro">
            <h3>{t("appSettings.pushover.title")}</h3>
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

          <div className="card-intro">
            <h3>{t("appSettings.smtp.title")}</h3>
            <p className="muted">{t("appSettings.smtp.subtitle")}</p>
          </div>
          <div className="form-grid">
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
      )}
    </div>
  );
}
