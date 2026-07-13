import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FiArrowLeft, FiCheck, FiPlus, FiRefreshCw, FiTrash2 } from "react-icons/fi";
import { useNavigate, useParams } from "react-router-dom";
import { CardSpendGoalField } from "../components/CardSpendGoalField";
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

function buildUpdateInput(values: UserFormValues, existing: User): UserUpdateInput {
  const input: UserUpdateInput = { name: values.name, color: values.color };
  if (values.pluggyClientId) input.pluggyClientId = values.pluggyClientId;
  if (values.pluggyClientSecret) input.pluggyClientSecret = values.pluggyClientSecret;
  if (values.pluggyItemIds !== existing.pluggyItemIds.join(", ")) {
    input.pluggyItemIds = values.pluggyItemIds || null;
  }
  return input;
}

export function ConfigUserProfile() {
  const { t } = useTranslation("config");
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";

  const { data: users } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const triggerSync = useTriggerSync();
  const [error, setError] = useState<string | null>(null);

  const existing = !isNew ? (users ?? []).find((u) => u.id === Number(id)) : undefined;

  return (
    <div>
      <button
        type="button"
        className="link-button"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          width: "fit-content",
          marginBottom: 16,
        }}
        onClick={() => navigate("/config")}
      >
        <FiArrowLeft /> {t("profile.back")}
      </button>

      <header className="config-header">
        <div>
          <h2>{isNew ? t("addForm.title") : (existing?.name ?? "")}</h2>
          <p className="muted">{isNew ? t("addForm.subtitle") : t("profile.subtitle")}</p>
        </div>
      </header>

      {error && (
        <p className="error" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}

      <div className="grid" style={{ gap: 24 }}>
        <div className="card">
          {!isNew && !existing ? (
            <p className="muted">{t("profile.notFound")}</p>
          ) : (
            <UserForm
              initial={existing}
              submitLabel={
                isNew ? (
                  <>
                    <FiPlus /> {t("addForm.submit")}
                  </>
                ) : (
                  <>
                    <FiCheck /> {t("editForm.submit")}
                  </>
                )
              }
              busy={isNew ? createUser.isPending : updateUser.isPending}
              onSubmit={(values) => {
                setError(null);
                if (isNew) {
                  const input: NewUserInput = {
                    name: values.name,
                    color: values.color,
                    pluggyClientId: values.pluggyClientId || undefined,
                    pluggyClientSecret: values.pluggyClientSecret || undefined,
                    pluggyItemIds: values.pluggyItemIds || undefined,
                  };
                  createUser.mutate(input, {
                    onSuccess: () => navigate("/config"),
                    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
                  });
                } else if (existing) {
                  updateUser.mutate(
                    { id: existing.id, input: buildUpdateInput(values, existing) },
                    { onError: (err) => setError(err instanceof Error ? err.message : String(err)) }
                  );
                }
              }}
            />
          )}
        </div>

        {!isNew && existing && (
          <div className="card">
            <h2>{t("profile.cardSpendGoal")}</h2>
            <CardSpendGoalField userId={existing.id} />
          </div>
        )}

        {!isNew && existing && (
          <div className="card">
            <h2>{t("profile.dangerZone")}</h2>
            <div className="form-actions">
              <button
                className="secondary"
                disabled={!existing.hasPluggyCredentials || triggerSync.isPending}
                onClick={() => triggerSync.mutate(existing.id)}
              >
                <FiRefreshCw /> {t("table.syncNow")}
              </button>
              <button
                className="danger"
                disabled={deleteUser.isPending}
                onClick={() => {
                  setError(null);
                  deleteUser.mutate(existing.id, {
                    onSuccess: () => navigate("/config"),
                    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
                  });
                }}
              >
                <FiTrash2 /> {t("table.remove")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
