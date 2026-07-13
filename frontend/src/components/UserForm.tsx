import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCheck, FiX } from "react-icons/fi";
import type { User } from "shared";
import { DEFAULT_PERSON_COLORS } from "../config";
import { useTestPluggyConnection } from "../hooks/useUsers";

export interface UserFormValues {
  name: string;
  color: string;
  pluggyClientId: string;
  pluggyClientSecret: string;
  pluggyItemIds: string;
}

export function UserForm(props: {
  initial?: User;
  submitLabel: ReactNode;
  busy?: boolean;
  onSubmit: (values: UserFormValues) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation("config");
  const u = props.initial;
  const [name, setName] = useState(u?.name ?? "");
  const [color, setColor] = useState(u?.color ?? DEFAULT_PERSON_COLORS[0]!);
  const [pluggyClientId, setPluggyClientId] = useState("");
  const [pluggyClientSecret, setPluggyClientSecret] = useState("");
  const [pluggyItemIds, setPluggyItemIds] = useState(u?.pluggyItemIds.join(", ") ?? "");
  const testConnection = useTestPluggyConnection();

  // A freshly-typed pair (about to be saved) takes priority over testing
  // what's already stored — matches the "test before you save" point of
  // this button. Falls back to the saved credentials only when the fields
  // are left blank (which means "keep existing" on an edit).
  const canTestTyped = pluggyClientId.trim() !== "" && pluggyClientSecret.trim() !== "";
  const canTestSaved = !canTestTyped && u?.hasPluggyCredentials;
  const canTest = canTestTyped || canTestSaved;

  function runTest() {
    testConnection.reset();
    if (canTestTyped) {
      testConnection.mutate({
        pluggyClientId: pluggyClientId.trim(),
        pluggyClientSecret: pluggyClientSecret.trim(),
      });
    } else if (u) {
      testConnection.mutate({ userId: u.id });
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name) return;
    props.onSubmit({ name, color, pluggyClientId, pluggyClientSecret, pluggyItemIds });
  }

  return (
    <form onSubmit={submit} className="grid" style={{ gap: 12 }}>
      <div className="form-grid">
        <label>
          {t("form.name")}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {t("form.color")}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
      </div>
      <div className="form-grid">
        <label>
          {t("form.pluggyClientId")}
          <input
            type="text"
            value={pluggyClientId}
            onChange={(e) => {
              setPluggyClientId(e.target.value);
              testConnection.reset();
            }}
            placeholder={u?.hasPluggyCredentials ? t("form.unchangedPlaceholder") : ""}
          />
        </label>
        <label>
          {t("form.pluggyClientSecret")}
          <input
            type="password"
            value={pluggyClientSecret}
            onChange={(e) => {
              setPluggyClientSecret(e.target.value);
              testConnection.reset();
            }}
            placeholder={u?.hasPluggyCredentials ? t("form.unchangedPlaceholder") : ""}
          />
        </label>
      </div>
      <div className="field-row">
        <button
          type="button"
          className="secondary"
          disabled={!canTest || testConnection.isPending}
          onClick={runTest}
        >
          {testConnection.isPending ? t("form.testingConnection") : t("form.testConnection")}
        </button>
        {testConnection.data &&
          (testConnection.data.ok ? (
            <span className="status-ok">
              <FiCheck /> {t("form.connectionOk")}
            </span>
          ) : (
            <span className="status-error">
              {t("form.connectionFailed", { error: testConnection.data.error })}
            </span>
          ))}
      </div>
      <label>
        {t("form.pluggyItemIds")}
        <textarea
          value={pluggyItemIds}
          onChange={(e) => setPluggyItemIds(e.target.value)}
          placeholder={t("form.pluggyItemIdsPlaceholder")}
          rows={2}
        />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={props.busy}>
          {props.submitLabel}
        </button>
        {props.onCancel && (
          <button type="button" className="secondary" onClick={props.onCancel}>
            <FiX /> {t("form.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
