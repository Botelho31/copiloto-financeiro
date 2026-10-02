import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LockGlyph } from "../components/LockControl";
import { ApiError } from "../lib/api";
import { useVaultTransition } from "../lib/vaultTransition";

export function VaultUnlock() {
  const { t } = useTranslation("vault");
  const { runUnlock } = useVaultTransition();
  const iconRef = useRef<SVGSVGElement>(null);

  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending || !iconRef.current) return;
    setPending(true);
    setErrorMessage(null);
    try {
      // On success this never returns in any way the user notices — the
      // full-page travelling-icon animation runs first, and the vault-status
      // cache flips (swapping this whole screen away) only once that's
      // already covering the page. A wrong password/recovery code rejects
      // before any of that starts, so the error below is the only thing
      // that ever gets a chance to render.
      await runUnlock(iconRef.current, useRecoveryCode ? { recoveryCode } : { password });
    } catch (err) {
      setPending(false);
      setErrorMessage(
        err instanceof ApiError && err.status === 401
          ? t(useRecoveryCode ? "unlock.wrongRecoveryCode" : "unlock.wrongPassword")
          : err instanceof Error
            ? err.message
            : String(err)
      );
    }
  }

  function toggleMode() {
    setUseRecoveryCode((v) => !v);
    setErrorMessage(null);
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <LockGlyph ref={iconRef} unlocked={false} size={40} />
        {useRecoveryCode ? (
          <label>
            {t("unlock.recoveryCode")}
            <input
              type="text"
              autoFocus
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
            />
          </label>
        ) : (
          <label>
            {t("unlock.password")}
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {errorMessage && <p className="error">{errorMessage}</p>}
        <button type="submit" disabled={pending}>
          {t("unlock.submit")}
        </button>
        <button type="button" className="link-button" onClick={toggleMode}>
          {t(useRecoveryCode ? "unlock.usePassword" : "unlock.useRecoveryCode")}
        </button>
      </form>
    </div>
  );
}
