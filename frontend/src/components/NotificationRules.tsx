import { useTranslation } from "react-i18next";
import { FiEdit2, FiTrash2 } from "react-icons/fi";
import type { NotificationRuleSettings } from "shared";
import { useEditableField } from "../hooks/useEditableField";
import {
  useDeleteRuleOverride,
  useNotificationRules,
  useUpdateNotificationRule,
} from "../hooks/useNotifications";

// One entry per backend rule (services/notifications/rules) — adding a new
// rule is: one more entry here (frontend, for its display copy + metadata
// field shape) plus a rule file + registry entry (backend), nothing else
// changes. `fields` describes each metadata key this rule exposes for
// editing, plus the value shown before anything's ever been saved for a
// scope (mirrors that field's zod .default(...) on the backend, so a blank
// household row and a freshly-loaded input agree). A rule with no
// configurable values (e.g. projected_shortfall) just has an empty array.
const RULE_TYPES = {
  large_transaction: {
    labelKey: "notifications.rules.largeTransaction.label",
    descriptionKey: "notifications.rules.largeTransaction.description",
    fields: [
      {
        key: "largeTransactionThreshold",
        labelKey: "notifications.rules.largeTransaction.threshold",
        hintKey: "notifications.rules.largeTransaction.thresholdHint",
        default: 500,
      },
    ],
  },
  projected_shortfall: {
    labelKey: "notifications.rules.projectedShortfall.label",
    descriptionKey: "notifications.rules.projectedShortfall.description",
    fields: [],
  },
} as const;

type RuleKey = keyof typeof RULE_TYPES;
const RULE_KEYS = Object.keys(RULE_TYPES) as RuleKey[];

function rowKey(key: string, userId: number | null): string {
  return `${key}:${userId ?? "household"}`;
}

function defaultMetadata(ruleKey: RuleKey): Record<string, unknown> {
  const fields = RULE_TYPES[ruleKey].fields as readonly { key: string; default: number }[];
  return Object.fromEntries(fields.map((f) => [f.key, f.default]));
}

function RuleMetadataField(props: {
  ruleKey: RuleKey;
  userId: number | null;
  field: { key: string; labelKey: string; hintKey: string };
  metadata: Record<string, unknown>;
}) {
  const { t } = useTranslation("config");
  const update = useUpdateNotificationRule();
  const savedValue = String(props.metadata[props.field.key] ?? "");
  const { value, setValue, save } = useEditableField(savedValue, (v) => {
    const trimmed = v.trim();
    if (!trimmed || trimmed === savedValue) return;
    update.mutate({
      key: props.ruleKey,
      userId: props.userId,
      input: { metadata: { [props.field.key]: Number(trimmed) } },
    });
  });

  return (
    <label>
      {t(props.field.labelKey)}
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
      />
      <span className="hint">{t(props.field.hintKey)}</span>
    </label>
  );
}

// A rule row backed by a real settings row for this exact scope (household
// when userId is null, otherwise one person's own override) — the checkbox
// and metadata fields edit that row directly. `onRemove`, when present,
// renders a button to drop a person's override back to the household default.
function EditableRuleRow(props: {
  ruleKey: RuleKey;
  userId: number | null;
  enabled: boolean;
  metadata: Record<string, unknown>;
  onRemove?: () => void;
}) {
  const { t } = useTranslation("config");
  const update = useUpdateNotificationRule();
  const meta = RULE_TYPES[props.ruleKey];

  return (
    <div>
      <div className="field-row">
        <input
          type="checkbox"
          checked={props.enabled}
          onChange={(e) =>
            update.mutate({
              key: props.ruleKey,
              userId: props.userId,
              input: { enabled: e.target.checked },
            })
          }
        />
        <strong>{t(meta.labelKey)}</strong>
        <span className="muted">{t(meta.descriptionKey)}</span>
        {props.onRemove && (
          <span className="row-actions" style={{ marginLeft: "auto" }}>
            <button
              type="button"
              className="danger icon"
              title={t("notifications.rules.removeOverride")}
              onClick={props.onRemove}
            >
              <FiTrash2 />
            </button>
          </span>
        )}
      </div>
      {meta.fields.length > 0 && (
        <div className="form-grid" style={{ marginTop: 8, marginLeft: 24 }}>
          {meta.fields.map((field) => (
            <RuleMetadataField
              key={field.key}
              ruleKey={props.ruleKey}
              userId={props.userId}
              field={field}
              metadata={props.metadata}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Household defaults — one row per rule, always editable, applies to
// anyone in the household without their own override (see
// NotificationRuleOverrides below).
export function NotificationRuleDefaults() {
  const { t } = useTranslation("config");
  const { data: rules } = useNotificationRules();
  const byKey = new Map((rules ?? []).map((r) => [rowKey(r.key, r.userId), r]));

  return (
    <div className="card">
      <h2>{t("notifications.rules.title")}</h2>
      <p className="muted">{t("notifications.rules.subtitle")}</p>
      <div className="grid" style={{ gap: 16, marginTop: 16 }}>
        {RULE_KEYS.map((key) => {
          const row = byKey.get(rowKey(key, null));
          return (
            <EditableRuleRow
              key={key}
              ruleKey={key}
              userId={null}
              enabled={row?.enabled ?? true}
              metadata={row?.metadata ?? defaultMetadata(key)}
            />
          );
        })}
      </div>
    </div>
  );
}

// This person's own overrides — a rule with no override row yet shows the
// household default it's currently inheriting, with a way to customize it;
// once customized it becomes a full EditableRuleRow with a way to remove
// the override and fall back to the household default again.
export function NotificationRuleOverrides(props: { userId: number }) {
  const { t } = useTranslation("config");
  const { data: rules } = useNotificationRules();
  const update = useUpdateNotificationRule();
  const del = useDeleteRuleOverride();
  const byKey = new Map((rules ?? []).map((r) => [rowKey(r.key, r.userId), r]));

  return (
    <div className="grid" style={{ gap: 16 }}>
      {RULE_KEYS.map((key) => {
        const override = byKey.get(rowKey(key, props.userId));
        if (override) {
          return (
            <EditableRuleRow
              key={key}
              ruleKey={key}
              userId={props.userId}
              enabled={override.enabled}
              metadata={override.metadata}
              onRemove={() => del.mutate({ key, userId: props.userId })}
            />
          );
        }

        const household: NotificationRuleSettings | undefined = byKey.get(rowKey(key, null));
        const effectiveEnabled = household?.enabled ?? true;
        const meta = RULE_TYPES[key];
        return (
          <div key={key} className="field-row">
            <strong>{t(meta.labelKey)}</strong>
            <span className="badge">
              {t(effectiveEnabled ? "notifications.rules.on" : "notifications.rules.off")}
            </span>
            <span className="muted">{t("notifications.rules.usingHouseholdDefault")}</span>
            <button
              type="button"
              className="secondary"
              style={{ marginLeft: "auto" }}
              onClick={() => update.mutate({ key, userId: props.userId, input: {} })}
            >
              <FiEdit2 /> {t("notifications.rules.customize")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
