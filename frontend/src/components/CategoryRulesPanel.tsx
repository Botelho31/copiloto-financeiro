import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiChevronDown, FiChevronRight, FiPlus, FiTrash2 } from "react-icons/fi";
import type { Category, CategoryRule } from "shared";
import { CategorySelect } from "./CategorySelect";
import { SortableTh } from "./SortableTh";
import {
  useCategoryRules,
  useCreateCategoryRule,
  useDeleteCategoryRule,
} from "../hooks/useCategories";
import { useSortableTable } from "../hooks/useSortableTable";

export function CategoryRulesPanel(props: { categories: Category[] }) {
  const { t } = useTranslation(["transactions", "common"]);
  const { data: rules } = useCategoryRules();
  const deleteRule = useDeleteCategoryRule();
  const createRule = useCreateCategoryRule();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [newMatchText, setNewMatchText] = useState("");
  const [newCategoryId, setNewCategoryId] = useState<number | null>(null);

  const filtered = (rules ?? []).filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return r.match_text.toLowerCase().includes(q) || r.category_name.toLowerCase().includes(q);
  });

  const { sorted, sortKey, direction, toggleSort } = useSortableTable<CategoryRule>(
    filtered,
    (r, key) => (key === "category" ? r.category_name : r.match_text),
    "category"
  );

  function submitNewRule(e: FormEvent) {
    e.preventDefault();
    if (!newMatchText.trim() || newCategoryId == null) return;
    createRule.mutate(
      { matchText: newMatchText.trim(), categoryId: newCategoryId },
      { onSuccess: () => setNewMatchText("") }
    );
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>{t("rules.title")}</h2>
        <button className="link-button" onClick={() => setOpen((o) => !o)}>
          {open ? <FiChevronDown /> : <FiChevronRight />} ({rules?.length ?? 0})
        </button>
      </div>
      {open && (
        <>
          <p className="muted" style={{ marginTop: 12 }}>
            {t("rules.description")}
          </p>

          <form
            onSubmit={submitNewRule}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "end",
              flexWrap: "wrap",
              marginBottom: 16,
            }}
          >
            <label>
              {t("rules.matchText")}
              <input
                type="text"
                placeholder={t("rules.matchTextPlaceholder")}
                value={newMatchText}
                onChange={(e) => setNewMatchText(e.target.value)}
              />
            </label>
            <label>
              {t("common:table.category")}
              <CategorySelect
                categories={props.categories}
                value={newCategoryId}
                placeholder={t("rules.categoryPlaceholder")}
                onChange={setNewCategoryId}
              />
            </label>
            <button type="submit">
              <FiPlus /> {t("rules.addRule")}
            </button>
          </form>

          <input
            type="text"
            placeholder={t("rules.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", maxWidth: 420, marginBottom: 12 }}
          />

          {sorted.length === 0 ? (
            <p className="muted">
              {search.trim() ? t("rules.noResultsForSearch") : t("rules.noRules")}
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <SortableTh
                    label={t("rules.matchText")}
                    sortKey="matchText"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                  />
                  <SortableTh
                    label={t("common:table.category")}
                    sortKey="category"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                  />
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id}>
                    <td>{r.match_text}</td>
                    <td>{r.category_name}</td>
                    <td>
                      <button
                        className="danger icon"
                        onClick={() => deleteRule.mutate(r.id)}
                        title={t("rules.deleteTitle")}
                      >
                        <FiTrash2 />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
