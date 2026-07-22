import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCheck, FiTrash2, FiX } from "react-icons/fi";
import type { NotificationProviderConfig } from "shared";
import { Dropdown } from "./Dropdown";
import {
  type TestProviderInput,
  type UpsertProviderInput,
  useDeleteNotificationProvider,
  useNotificationProviders,
  useTestNotificationProvider,
  useUpsertNotificationProvider,
} from "../hooks/useNotifications";

// One entry per backend provider (services/notifications/providers) —
// adding a new provider type is: one more entry here (frontend) plus a
// handler + registry entry (backend), nothing else changes. `fields`
// describes each config key this provider needs (most need just one, e.g.
// Pushover's user key — CallMeBot needs two: phone + apikey).
const PROVIDER_TYPES = {
  pushover: {
    provider: "pushover",
    labelKey: "notifications.pushover",
    fields: [
      { key: "userKey", placeholderKey: "notifications.pushoverPlaceholder", inputType: "text" },
    ],
  },
  email: {
    provider: "email",
    labelKey: "notifications.email",
    fields: [
      { key: "address", placeholderKey: "notifications.emailPlaceholder", inputType: "email" },
    ],
  },
  callmebot: {
    provider: "callmebot",
    labelKey: "notifications.callmebot",
    fields: [
      { key: "phone", placeholderKey: "notifications.callmebotPhonePlaceholder", inputType: "tel" },
      {
        key: "apikey",
        placeholderKey: "notifications.callmebotApikeyPlaceholder",
        inputType: "text",
      },
    ],
  },
} as const;

type ProviderKey = keyof typeof PROVIDER_TYPES;
const PROVIDER_KEYS = Object.keys(PROVIDER_TYPES) as ProviderKey[];

function buildUpsertInput(
  userId: number,
  key: ProviderKey,
  config: Record<string, string>
): UpsertProviderInput {
  if (key === "pushover")
    return { userId, provider: "pushover", config: { userKey: config.userKey! } };
  if (key === "email") return { userId, provider: "email", config: { address: config.address! } };
  return {
    userId,
    provider: "callmebot",
    config: { phone: config.phone!, apikey: config.apikey! },
  };
}

function buildTestInput(key: ProviderKey, config: Record<string, string>): TestProviderInput {
  if (key === "pushover") return { provider: "pushover", config: { userKey: config.userKey! } };
  if (key === "email") return { provider: "email", config: { address: config.address! } };
  return { provider: "callmebot", config: { phone: config.phone!, apikey: config.apikey! } };
}

function savedFieldValues(
  providerKey: ProviderKey,
  existing: NotificationProviderConfig | undefined
): Record<string, string> {
  const fields = PROVIDER_TYPES[providerKey].fields;
  return Object.fromEntries(fields.map((f) => [f.key, String(existing?.config[f.key] ?? "")]));
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

  const saved = savedFieldValues(props.providerKey, props.existing);
  const [values, setValues] = useState(saved);
  useEffect(
    () => setValues(savedFieldValues(props.providerKey, props.existing)),
    [props.providerKey, props.existing]
  );

  const trimmed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]));
  const isComplete = meta.fields.every((f) => trimmed[f.key]);
  const isDirty = JSON.stringify(trimmed) !== JSON.stringify(saved);

  function save() {
    if (!isComplete || !isDirty) return;
    upsert.mutate(buildUpsertInput(props.userId, props.providerKey, trimmed));
  }

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
      {meta.fields.map((field, i) => (
        <input
          key={field.key}
          type={field.inputType}
          value={values[field.key] ?? ""}
          onChange={(e) => {
            setValues((v) => ({ ...v, [field.key]: e.target.value }));
            test.reset();
          }}
          onBlur={save}
          placeholder={t(field.placeholderKey)}
          style={{ width: meta.fields.length > 1 ? 150 : 220 }}
          autoFocus={i === 0 && !props.existing}
        />
      ))}
      <button
        type="button"
        className="secondary"
        disabled={!isComplete || test.isPending}
        onClick={() =>
          test.mutate(
            props.existing && !isDirty
              ? { providerId: props.existing.id }
              : buildTestInput(props.providerKey, trimmed)
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
