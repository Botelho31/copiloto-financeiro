import { useTranslation } from "react-i18next";
import { FiCheck, FiTrash2, FiX } from "react-icons/fi";
import type { NotificationProviderConfig } from "shared";
import {
  useDeleteNotificationProvider,
  useNotificationProviders,
  useTestNotificationProvider,
  useUpsertNotificationProvider,
} from "../hooks/useNotifications";
import { useEditableField } from "../hooks/useEditableField";

function ProviderRow(props: {
  userId: number;
  provider: "pushover" | "email";
  label: string;
  placeholder: string;
  fieldKey: "userKey" | "address";
  existing: NotificationProviderConfig | undefined;
}) {
  const { t } = useTranslation("config");
  const upsert = useUpsertNotificationProvider();
  const del = useDeleteNotificationProvider();
  const test = useTestNotificationProvider();

  const savedValue = (props.existing?.config[props.fieldKey] as string | undefined) ?? "";
  const { value, setValue, save } = useEditableField(savedValue, (v) => {
    const trimmed = v.trim();
    if (!trimmed || trimmed === savedValue) return;
    if (props.provider === "pushover") {
      upsert.mutate({ userId: props.userId, provider: "pushover", config: { userKey: trimmed } });
    } else {
      upsert.mutate({ userId: props.userId, provider: "email", config: { address: trimmed } });
    }
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span className="label muted" style={{ minWidth: 70 }}>
        {props.label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          test.reset();
        }}
        onBlur={save}
        placeholder={props.placeholder}
        style={{ width: 220 }}
      />
      <button
        type="button"
        className="secondary"
        disabled={!value.trim() || test.isPending}
        onClick={() =>
          test.mutate(
            props.existing && savedValue === value.trim()
              ? { providerId: props.existing.id }
              : ({ provider: props.provider, config: { [props.fieldKey]: value.trim() } } as
                  | { provider: "pushover"; config: { userKey: string } }
                  | { provider: "email"; config: { address: string } })
          )
        }
      >
        {test.isPending ? t("form.testingConnection") : t("form.testConnection")}
      </button>
      {props.existing && (
        <button
          type="button"
          className="danger icon"
          title={t("table.remove")}
          onClick={() => {
            del.mutate(props.existing!.id);
            setValue("");
          }}
        >
          <FiTrash2 />
        </button>
      )}
      {test.data &&
        (test.data.ok ? (
          <span
            style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <FiCheck /> {t("form.connectionOk")}
          </span>
        ) : (
          <span
            className="shortfall"
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <FiX /> {test.data.error}
          </span>
        ))}
    </div>
  );
}

export function NotificationProviders(props: { userId: number }) {
  const { t } = useTranslation("config");
  const { data: providers } = useNotificationProviders(props.userId);

  const pushover = (providers ?? []).find((p) => p.provider === "pushover");
  const email = (providers ?? []).find((p) => p.provider === "email");

  return (
    <div className="grid" style={{ gap: 10 }}>
      <p className="muted" style={{ margin: 0 }}>
        {t("notifications.description")}
      </p>
      <ProviderRow
        userId={props.userId}
        provider="pushover"
        fieldKey="userKey"
        label={t("notifications.pushover")}
        placeholder={t("notifications.pushoverPlaceholder")}
        existing={pushover}
      />
      <ProviderRow
        userId={props.userId}
        provider="email"
        fieldKey="address"
        label={t("notifications.email")}
        placeholder={t("notifications.emailPlaceholder")}
        existing={email}
      />
    </div>
  );
}
