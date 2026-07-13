import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiPlus, FiTrash2 } from "react-icons/fi";
import type { Category } from "shared";
import { Dropdown } from "../components/Dropdown";
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from "../hooks/useCategories";
import { useEditableField } from "../hooks/useEditableField";

function CategoryRow(props: { category: Category }) {
  const { t } = useTranslation("config");
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const {
    value: name,
    setValue: setName,
    save: saveName,
  } = useEditableField(props.category.name, (v) => {
    const trimmed = v.trim();
    if (!trimmed || trimmed === props.category.name) return;
    updateCategory.mutate({ id: props.category.id, input: { name: trimmed } });
  });
  const isProtected = props.category.name === "Uncategorized";

  return (
    <tr>
      <td>
        <input
          type="color"
          value={props.category.color}
          onChange={(e) =>
            updateCategory.mutate({
              id: props.category.id,
              input: { color: e.target.value },
            })
          }
          style={{ width: 36, padding: 2 }}
        />
      </td>
      <td>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
        />
      </td>
      <td className="muted">
        {props.category.kind === "income" ? t("categories.income") : t("categories.expense")}
      </td>
      <td style={{ textAlign: "right" }}>
        <span className="row-actions">
          <button
            className="danger icon"
            title={isProtected ? t("categories.protected") : t("table.remove")}
            disabled={isProtected || deleteCategory.isPending}
            onClick={() => deleteCategory.mutate(props.category.id)}
          >
            <FiTrash2 />
          </button>
        </span>
      </td>
    </tr>
  );
}

export function ConfigCategories() {
  const { t } = useTranslation("config");
  const { data: categories } = useCategories();
  const createCategory = useCreateCategory();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"income" | "expense">("expense");

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createCategory.mutate({ name: trimmed, kind }, { onSuccess: () => setName("") });
  }

  return (
    <div>
      <header className="config-header">
        <div>
          <h2>{t("categories.title")}</h2>
          <p className="muted">{t("categories.subtitle")}</p>
        </div>
      </header>

      <div className="grid" style={{ gap: 24 }}>
        <div className="card">
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }} />
                <th>{t("table.name")}</th>
                <th>{t("categories.kind")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(categories ?? []).map((c) => (
                <CategoryRow key={c.id} category={c} />
              ))}
            </tbody>
          </table>
        </div>

        <form className="card grid" style={{ gap: 12 }} onSubmit={submit}>
          <h2>{t("categories.addForm.title")}</h2>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ flex: 1, minWidth: 180 }}>
              {t("table.name")}
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label style={{ minWidth: 140 }}>
              {t("categories.kind")}
              <Dropdown
                value={kind}
                onChange={setKind}
                placeholder={t("categories.kind")}
                ariaLabel={t("categories.kind")}
                options={[
                  { value: "expense", label: t("categories.expense") },
                  { value: "income", label: t("categories.income") },
                ]}
              />
            </label>
            <button type="submit" disabled={!name.trim() || createCategory.isPending}>
              <FiPlus /> {t("categories.addForm.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
