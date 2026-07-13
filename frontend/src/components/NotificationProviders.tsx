import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCheck, FiTrash2, FiX } from "react-icons/fi";
import type { NotificationProviderConfig } from "shared";
import { Dropdown } from "./Dropdown";
import { useEditableField } from "../hooks/useEditableField";
import {
  type TestProviderInput,
  type UpsertProviderInput,
  useDeleteNotificationProvider,
  useNotificationProviders,
  useTestNotificationProvider,
  useUpsertNotificationProvider,
} from "../hooks/useNotifications";

// One entry per backend provider (services/notifications/providers) — adding
// a new provider type is: one more entry here (frontend) plus a handler +
// registry entry (backend), nothing else changes.
const PROVIDER_TYPES = {
  pushover: {
    provider: "pushover",
    fieldKey: "userKey",
    labelKey: "notifications.pushover",
    placeholderKey: "notifications.pushoverPlaceholder",
    inputType: "text",
  },
  email: {
    provider: "email",
    fieldKey: "address",
    labelKey: "notifications.email",
    placeholderKey: "notifications.emailPlaceholder",
    inputType: "email",
  },
} as const;

type ProviderKey = keyof typeof PROVIDER_TYPES;
const PROVIDER_KEYS = Object.keys(PROVIDER_TYPES) as ProviderKey[];

function buildUpsertInput(userId: number, key: ProviderKey, value: string): UpsertProviderInput {
  return key === "pushover"
    ? { userId, provider: "pushover", config: { userKey: value } }
    : { userId, provider: "email", config: { address: value } };
}

function buildTestInput(key: ProviderKey, value: string): TestProviderInput {
  return key === "pushover"
    ? { provider: "pushover", config: { userKey: value } }
    : { provider: "email", config: { address: value } };
}

function ProviderRow(props: {
  userId: number;
  providerKey: ProviderKey;
  existing: NotificationProviderConfig | undefined;
  onRemoved: () => void;
}) {
  const { t } = useTranslation("config");
  const upsert = useUpsertNotificationProvider();
  const del = useDeleteNotificationProvider();
  const test = useTestNotificationProvider();
  const meta = PROVIDER_TYPES[props.providerKey];

  const savedValue = (props.existing?.config[meta.fieldKey] as string | undefined) ?? "";
  const { value, setValue, save } = useEditableField(savedValue, (v) => {
    const trimmed = v.trim();
    if (!trimmed || trimmed === savedValue) return;
    upsert.mutate(buildUpsertInput(props.userId, props.providerKey, trimmed));
  });

  function handleRemove() {
    if (props.existing) {
      del.mutate(props.existing.id, { onSuccess: props.onRemoved });
    } else {
      props.onRemoved();
    }
  }

  return (
    <div className="field-row">
      <span className="label muted" style={{ minWidth: 70 }}>
        {t(meta.labelKey)}
      </span>
      <input
        type={meta.inputType}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          test.reset();
        }}
        onBlur={save}
        placeholder={t(meta.placeholderKey)}
        style={{ width: 220 }}
        autoFocus={!props.existing}
      />
      <button
        type="button"
        className="secondary"
        disabled={!value.trim() || test.isPending}
        onClick={() =>
          test.mutate(
            props.existing && savedValue === value.trim()
              ? { providerId: props.existing.id }
              : buildTestInput(props.providerKey, value.trim())
          )
        }
      >
        {test.isPending ? t("form.testingConnection") : t("form.testConnection")}
      </button>
      <button
        type="button"
        className="danger icon"
        title={t("table.remove")}
        disabled={del.isPending}
        onClick={handleRemove}
      >
        <FiTrash2 />
      </button>
      {test.data &&
        (test.data.ok ? (
          <span className="status-ok">
            <FiCheck /> {t("form.connectionOk")}
          </span>
        ) : (
          <span className="status-error">
            <FiX /> {test.data.error}
          </span>
        ))}
    </div>
  );
}

export function NotificationProviders(props: { userId: number }) {
  const { t } = useTranslation("config");
  const { data: providers } = useNotificationProviders(props.userId);
  // Provider types the user has explicitly opened an empty row for but not
  // saved yet — union'd with whatever's already configured below, so a type
  // only ever shows a row once it's either saved or deliberately added.
  const [pendingTypes, setPendingTypes] = useState<ProviderKey[]>([]);

  const configuredKeys = new Set((providers ?? []).map((p) => p.provider));
  const visibleKeys = PROVIDER_KEYS.filter(
    (k) => configuredKeys.has(k) || pendingTypes.includes(k)
  );
  const availableToAdd = PROVIDER_KEYS.filter((k) => !visibleKeys.includes(k));

  return (
    <div className="grid" style={{ gap: 10 }}>
      {visibleKeys.length === 0 && <p className="muted">{t("notifications.empty")}</p>}
      {visibleKeys.map((key) => (
        <ProviderRow
          key={key}
          userId={props.userId}
          providerKey={key}
          existing={(providers ?? []).find((p) => p.provider === key)}
          onRemoved={() => setPendingTypes((prev) => prev.filter((k) => k !== key))}
        />
      ))}
      {availableToAdd.length > 0 && (
        <div style={{ maxWidth: 220 }}>
          <Dropdown
            value=""
            placeholder={t("notifications.addProvider")}
            onChange={(k) => setPendingTypes((prev) => [...prev, k])}
            options={availableToAdd.map((k) => ({
              value: k,
              label: t(PROVIDER_TYPES[k].labelKey),
            }))}
          />
        </div>
      )}
    </div>
  );
}
