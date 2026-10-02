import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCheck, FiCopy } from "react-icons/fi";
import { useInvalidateVaultStatus, useSetupVault } from "../hooks/useVault";

export function VaultSetup() {
  const { t } = useTranslation("vault");
  const setupVault = useSetupVault();
  const invalidateVaultStatus = useInvalidateVaultStatus();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setValidationError(t("setup.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setValidationError(t("setup.passwordMismatch"));
      return;
    }
    setValidationError(null);
    setupVault.mutate(password);
  }

  async function copyRecoveryCode() {
    if (!setupVault.data) return;
    await navigator.clipboard.writeText(setupVault.data.recoveryCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (setupVault.data) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>{t("setup.recoveryTitle")}</h1>
          <p className="muted">{t("setup.recoverySubtitle")}</p>
          <code className="recovery-code">{setupVault.data.recoveryCode}</code>
          <button type="button" className="secondary" onClick={copyRecoveryCode}>
            {copied ? <FiCheck /> : <FiCopy />}
            {copied ? t("setup.copied") : t("setup.copy")}
          </button>
          <label className="field-row">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            {t("setup.acknowledge")}
          </label>
          <button type="button" disabled={!acknowledged} onClick={() => invalidateVaultStatus()}>
            {t("setup.continue")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1>{t("setup.title")}</h1>
        <p className="muted">{t("setup.subtitle")}</p>
        <label>
          {t("setup.password")}
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          {t("setup.confirmPassword")}
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>
        {validationError && <p className="error">{validationError}</p>}
        <button type="submit" disabled={setupVault.isPending}>
          {t("setup.submit")}
        </button>
      </form>
    </div>
  );
}
