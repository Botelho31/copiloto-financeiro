import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCheck, FiEdit2, FiPlus, FiRefreshCw, FiTrash2, FiX } from "react-icons/fi";
import { useTriggerSync } from "../hooks/useSync";
import { useUpdateUserSettings, useUserSettings } from "../hooks/useSettings";
import {
  useCreateUser,
  useDeleteUser,
  useUpdateUser,
  useUsers,
  type NewUserInput,
  type UserUpdateInput,
} from "../hooks/useUsers";
import { formatMoney } from "../lib/format";
import type { User } from "shared";

const DEFAULT_COLORS = ["#5f7fbf", "#4c9a6a", "#c98a3e", "#9c5b4a", "#8c6a9c", "#5c8b99"];

function Swatch(props: { color: string }) {
  return (
    <span
      style={{
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: props.color,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

interface UserFormValues {
  name: string;
  color: string;
  pluggyClientId: string;
  pluggyClientSecret: string;
  pluggyItemIds: string;
}

function UserForm(props: {
  initial?: User;
  submitLabel: ReactNode;
  busy?: boolean;
  onSubmit: (values: UserFormValues) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation("config");
  const u = props.initial;
  const [name, setName] = useState(u?.name ?? "");
  const [color, setColor] = useState(u?.color ?? DEFAULT_COLORS[0]!);
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

function CardSpendGoalField(props: { userId: number }) {
  const { t } = useTranslation("config");
  const { data: settings } = useUserSettings(props.userId);
  const updateSettings = useUpdateUserSettings(props.userId);
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        className="link-button"
        onClick={() => {
          setValue(settings?.cardSpendGoal != null ? String(settings.cardSpendGoal) : "");
          setEditing(true);
        }}
      >
        {settings?.cardSpendGoal != null
          ? t("table.cardSpendGoalValue", { amount: formatMoney(settings.cardSpendGoal) })
          : t("table.cardSpendGoalUnset")}
      </button>
    );
  }

  return (
    <form
      style={{ display: "flex", gap: 6, alignItems: "center" }}
      onSubmit={(e) => {
        e.preventDefault();
        updateSettings.mutate(
          { cardSpendGoal: value === "" ? null : Number(value) },
          { onSuccess: () => setEditing(false) }
        );
      }}
    >
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ width: 110 }}
        autoFocus
      />
      <button
        type="submit"
        className="icon"
        disabled={updateSettings.isPending}
        title={t("form.save")}
      >
        <FiCheck />
      </button>
      <button
        type="button"
        className="secondary icon"
        onClick={() => setEditing(false)}
        title={t("form.cancel")}
      >
        <FiX />
      </button>
    </form>
  );
}

export function ConfigPage() {
  const { t } = useTranslation("config");
  const { data: users } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const triggerSync = useTriggerSync();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function buildUpdateInput(values: UserFormValues, existing: User): UserUpdateInput {
    const input: UserUpdateInput = { name: values.name, color: values.color };
    if (values.pluggyClientId) input.pluggyClientId = values.pluggyClientId;
    if (values.pluggyClientSecret) input.pluggyClientSecret = values.pluggyClientSecret;
    if (values.pluggyItemIds !== existing.pluggyItemIds.join(", ")) {
      input.pluggyItemIds = values.pluggyItemIds || null;
    }
    return input;
  }

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="card">
        <h2>{t("title")}</h2>
        <p className="muted">{t("subtitle")}</p>
        {error && (
          <p className="shortfall" style={{ marginBottom: 12 }}>
            {error}
          </p>
        )}
        <table>
          <thead>
            <tr>
              <th>{t("table.name")}</th>
              <th>{t("table.pluggy")}</th>
              <th>{t("table.cardSpendGoal")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => {
              if (editingId === u.id) {
                return (
                  <tr key={u.id}>
                    <td colSpan={4} style={{ padding: "16px 12px", background: "var(--ink)" }}>
                      <UserForm
                        initial={u}
                        submitLabel={
                          <>
                            <FiCheck /> {t("editForm.submit")}
                          </>
                        }
                        busy={updateUser.isPending}
                        onCancel={() => setEditingId(null)}
                        onSubmit={(values) =>
                          updateUser.mutate(
                            { id: u.id, input: buildUpdateInput(values, u) },
                            { onSuccess: () => setEditingId(null) }
                          )
                        }
                      />
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={u.id}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <Swatch color={u.color} />
                      {u.name}
                    </span>
                  </td>
                  <td>
                    {u.hasPluggyCredentials ? (
                      <span className="badge">
                        {t("table.pluggyConnected", { count: u.pluggyItemIds.length })}
                      </span>
                    ) : (
                      <span className="muted">{t("table.pluggyNotConnected")}</span>
                    )}
                  </td>
                  <td>
                    <CardSpendGoalField userId={u.id} />
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      className="secondary icon"
                      title={t("table.syncNow")}
                      disabled={!u.hasPluggyCredentials || triggerSync.isPending}
                      onClick={() => triggerSync.mutate(u.id)}
                    >
                      <FiRefreshCw />
                    </button>{" "}
                    <button
                      className="secondary icon"
                      title={t("table.edit")}
                      onClick={() => setEditingId(u.id)}
                    >
                      <FiEdit2 />
                    </button>{" "}
                    <button
                      className="danger icon"
                      title={t("table.remove")}
                      onClick={() => {
                        setError(null);
                        deleteUser.mutate(u.id, {
                          onError: (err) =>
                            setError(err instanceof Error ? err.message : String(err)),
                        });
                      }}
                    >
                      <FiTrash2 />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {(users ?? []).length === 0 && <p className="muted">{t("empty")}</p>}
      </div>

      <div className="card">
        <h2>{t("addForm.title")}</h2>
        <p className="muted">{t("addForm.subtitle")}</p>
        <UserForm
          key={formKey}
          submitLabel={
            <>
              <FiPlus /> {t("addForm.submit")}
            </>
          }
          busy={createUser.isPending}
          onSubmit={(values) => {
            const input: NewUserInput = {
              name: values.name,
              color: values.color,
              pluggyClientId: values.pluggyClientId || undefined,
              pluggyClientSecret: values.pluggyClientSecret || undefined,
              pluggyItemIds: values.pluggyItemIds || undefined,
            };
            setError(null);
            createUser.mutate(input, {
              onSuccess: () => setFormKey((k) => k + 1),
              onError: (err) => setError(err instanceof Error ? err.message : String(err)),
            });
          }}
        />
      </div>
    </div>
  );
}
