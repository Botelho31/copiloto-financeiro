import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCheck, FiEdit2, FiPlus, FiRefreshCw, FiTrash2 } from "react-icons/fi";
import { CardSpendGoalField } from "../components/CardSpendGoalField";
import { ColorSwatch } from "../components/ColorSwatch";
import { UserForm, type UserFormValues } from "../components/UserForm";
import { useTriggerSync } from "../hooks/useSync";
import {
  useCreateUser,
  useDeleteUser,
  useUpdateUser,
  useUsers,
  type NewUserInput,
  type UserUpdateInput,
} from "../hooks/useUsers";
import type { User } from "shared";

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
                      <ColorSwatch color={u.color} size={12} />
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
