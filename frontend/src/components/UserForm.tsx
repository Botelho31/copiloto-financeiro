import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiX } from "react-icons/fi";
import type { User } from "shared";
import { DEFAULT_PERSON_COLORS } from "../config";

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

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name) return;
    props.onSubmit({ name, color, pluggyClientId, pluggyClientSecret, pluggyItemIds });
  }

  return (
    <form onSubmit={submit} className="grid" style={{ gap: 12 }}>
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}
      >
        <label>
          {t("form.name")}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {t("form.color")}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
      </div>
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}
      >
        <label>
          {t("form.pluggyClientId")}
          <input
            type="text"
            value={pluggyClientId}
            onChange={(e) => setPluggyClientId(e.target.value)}
            placeholder={u?.hasPluggyCredentials ? t("form.unchangedPlaceholder") : ""}
          />
        </label>
        <label>
          {t("form.pluggyClientSecret")}
          <input
            type="password"
            value={pluggyClientSecret}
            onChange={(e) => setPluggyClientSecret(e.target.value)}
            placeholder={u?.hasPluggyCredentials ? t("form.unchangedPlaceholder") : ""}
          />
        </label>
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
