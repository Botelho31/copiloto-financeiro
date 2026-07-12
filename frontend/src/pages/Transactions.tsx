import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Category, Transaction } from "shared";
import { CategoryRulesPanel } from "../components/CategoryRulesPanel";
import { CategorySelect } from "../components/CategorySelect";
import { GroupedTransactionList } from "../components/GroupedTransactionList";
import { PeriodPicker } from "../components/PeriodPicker";
import { SortableTh } from "../components/SortableTh";
import { useAccounts } from "../hooks/useAccounts";
import {
  useBulkAssignCategory,
  useCategories,
  useUncategorizedGroups,
} from "../hooks/useCategories";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useSortableTable } from "../hooks/useSortableTable";
import {
  useEarliestTransactionDate,
  usePaginatedTransactions,
  useSearchTransactions,
  useTransactions,
  useUpdateTransactionCategory,
} from "../hooks/useTransactions";
import { formatDate, formatMoney } from "../lib/format";
import { parseIsoDate, periodFor, periodToRange, type Period } from "../lib/period";
import { TRANSACTIONS_PAGE_SIZE } from "../config";

export function TransactionsPage() {
  const { t } = useTranslation(["transactions", "common"]);
  const [period, setPeriod] = useState<Period>(() => periodFor("month"));
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [accountId, setAccountId] = useState<string | undefined>();
  const [grouped, setGrouped] = useState(false);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const searchQuery = useDebouncedValue(searchInput);

  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const { from, to } = periodToRange(period);
  const filters = { from, to, categoryId, accountId };

  // Grouping by description needs every transaction in the period to count
  // correctly, so it stays on the full (unpaginated) fetch; the raw table
  // is pure browsing and is the only view that pages.
  const { data: groupedTransactions, isLoading: isLoadingGrouped } = useTransactions(filters, {
    enabled: grouped,
  });
  const { data: paginated, isLoading: isLoadingPage } = usePaginatedTransactions(
    filters,
    page,
    TRANSACTIONS_PAGE_SIZE
  );
  const isLoading = grouped ? isLoadingGrouped : isLoadingPage;

  function changePeriod(next: Period) {
    setPeriod(next);
    setPage(1);
  }
  function changeAccountId(next: string | undefined) {
    setAccountId(next);
    setPage(1);
  }
  function changeCategoryId(next: number | undefined) {
    setCategoryId(next);
    setPage(1);
  }

  const { data: uncategorizedGroups } = useUncategorizedGroups();
  const { data: earliestTransactionDate } = useEarliestTransactionDate();
  const { data: searchResults, isFetching: isSearching } = useSearchTransactions(searchQuery);
  const bulkAssign = useBulkAssignCategory();
  const updateCategory = useUpdateTransactionCategory();

  const allTimeStart = earliestTransactionDate?.date
    ? parseIsoDate(earliestTransactionDate.date)
    : undefined;

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="card">
        <h2>{t("title")}</h2>
        <div style={{ marginBottom: 16 }}>
          <PeriodPicker value={period} onChange={changePeriod} allTimeStart={allTimeStart} />
        </div>
        <div
          className="grid"
          style={{
            gridTemplateColumns: "repeat(2, auto)",
            marginBottom: 16,
            alignItems: "end",
          }}
        >
          <label>
            {t("filters.account")}
            <select
              value={accountId ?? ""}
              onChange={(e) => changeAccountId(e.target.value || undefined)}
            >
              <option value="">{t("filters.allAccounts")}</option>
              {(accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("filters.category")}
            <select
              value={categoryId ?? ""}
              onChange={(e) =>
                changeCategoryId(e.target.value ? Number(e.target.value) : undefined)
              }
            >
              <option value="">{t("filters.allCategories")}</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label style={{ flexDirection: "row", gap: 6, alignItems: "center", marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={grouped}
            onChange={(e) => {
              setGrouped(e.target.checked);
              setPage(1);
            }}
          />
          {t("filters.groupByDescription")}
        </label>

        {isLoading ? (
          <p className="muted">{t("loading")}</p>
        ) : grouped ? (
          <GroupedTransactionList
            transactions={groupedTransactions ?? []}
            categories={categories ?? []}
          />
        ) : (
          <>
            <TransactionsTable
              transactions={paginated?.items ?? []}
              categories={categories ?? []}
              onCategorize={(id, catId) =>
                updateCategory.mutate({ id, categoryId: catId, createRule: true })
              }
            />
            {paginated && paginated.total > paginated.pageSize && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 12,
                }}
              >
                <span className="muted">
                  {t("pagination.showing", {
                    from: (paginated.page - 1) * paginated.pageSize + 1,
                    to: Math.min(paginated.page * paginated.pageSize, paginated.total),
                    total: paginated.total,
                  })}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="secondary"
                    disabled={paginated.page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    {t("pagination.prev")}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={paginated.page * paginated.pageSize >= paginated.total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t("pagination.next")}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {uncategorizedGroups && uncategorizedGroups.length > 0 && (
        <div className="card">
          <h2>{t("categorize.title")}</h2>
          <UncategorizedGroupsTable
            groups={uncategorizedGroups}
            categories={categories ?? []}
            onAssign={(key, categoryId) => bulkAssign.mutate({ key, categoryId })}
          />
        </div>
      )}

      <CategoryRulesPanel categories={categories ?? []} />

      <div className="card">
        <h2>{t("search.title")}</h2>
        <p className="muted">{t("search.description")}</p>
        <input
          type="text"
          placeholder={t("search.placeholder")}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ width: "100%", maxWidth: 420, marginBottom: 16 }}
        />
        {searchQuery.trim() &&
          (isSearching ? (
            <p className="muted">{t("search.searching")}</p>
          ) : (
            <GroupedTransactionList
              transactions={searchResults ?? []}
              categories={categories ?? []}
            />
          ))}
      </div>
    </div>
  );
}

function UncategorizedGroupsTable(props: {
  groups: { key: string; sampleDescription: string; count: number; totalAmount: number }[];
  categories: Category[];
  onAssign: (key: string, categoryId: number) => void;
}) {
  const { t } = useTranslation(["transactions", "common"]);
  const { sorted, sortKey, direction, toggleSort } = useSortableTable(
    props.groups,
    (g, key) => {
      switch (key) {
        case "description":
          return g.sampleDescription;
        case "count":
          return g.count;
        default:
          return g.totalAmount;
      }
    },
    "total",
    "desc"
  );

  return (
    <table>
      <thead>
        <tr>
          <SortableTh
            label={t("common:table.description")}
            sortKey="description"
            activeKey={sortKey}
            direction={direction}
            onSort={toggleSort}
          />
          <SortableTh
            label={t("common:table.count")}
            sortKey="count"
            activeKey={sortKey}
            direction={direction}
            onSort={toggleSort}
          />
          <SortableTh
            label={t("common:table.total")}
            sortKey="total"
            activeKey={sortKey}
            direction={direction}
            onSort={toggleSort}
          />
          <th>{t("categorize.assignTo")}</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((group) => (
          <tr key={group.key}>
            <td>{group.sampleDescription}</td>
            <td className="money">{group.count}</td>
            <td className="money">{formatMoney(group.totalAmount)}</td>
            <td>
              <CategorySelect
                categories={props.categories}
                value={null}
                placeholder={t("categorize.choosePlaceholder")}
                onChange={(catId) => props.onAssign(group.key, catId)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TransactionsTable(props: {
  transactions: Transaction[];
  categories: Category[];
  onCategorize: (id: string, categoryId: number) => void;
}) {
  const { t } = useTranslation("common");
  const { sorted, sortKey, direction, toggleSort } = useSortableTable<Transaction>(
    props.transactions,
    (t, key) => {
      switch (key) {
        case "date":
          return t.date;
        case "description":
          return t.description;
        case "category":
          return t.category_name ?? "";
        default:
          return t.amount;
      }
    },
    "date",
    "desc"
  );

  return (
    <table>
      <thead>
        <tr>
          <SortableTh
            label={t("table.date")}
            sortKey="date"
            activeKey={sortKey}
            direction={direction}
            onSort={toggleSort}
          />
          <SortableTh
            label={t("table.description")}
            sortKey="description"
            activeKey={sortKey}
            direction={direction}
            onSort={toggleSort}
          />
          <SortableTh
            label={t("table.amount")}
            sortKey="amount"
            activeKey={sortKey}
            direction={direction}
            onSort={toggleSort}
          />
          <SortableTh
            label={t("table.category")}
            sortKey="category"
            activeKey={sortKey}
            direction={direction}
            onSort={toggleSort}
          />
        </tr>
      </thead>
      <tbody>
        {sorted.map((t) => (
          <tr key={t.id}>
            <td>{formatDate(t.date)}</td>
            <td>{t.description}</td>
            <td className={t.type === "DEBIT" ? "money shortfall" : "money"}>
              {formatMoney(t.amount, t.currency_code)}
            </td>
            <td>
              <CategorySelect
                categories={props.categories}
                value={t.category_id}
                onChange={(categoryId) => props.onCategorize(t.id, categoryId)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
