import { type FormEvent, useEffect, useState } from "react";
import { FiChevronDown, FiChevronRight, FiPlus, FiTrash2 } from "react-icons/fi";
import type { Category, CategoryRule, Transaction } from "shared";
import { CategorySelect } from "../components/CategorySelect";
import { GroupedTransactionList } from "../components/GroupedTransactionList";
import { PeriodPicker } from "../components/PeriodPicker";
import { SortableTh } from "../components/SortableTh";
import { useAccounts } from "../hooks/useAccounts";
import {
  useBulkAssignCategory,
  useCategories,
  useCategoryRules,
  useCreateCategoryRule,
  useDeleteCategoryRule,
  useUncategorizedGroups,
} from "../hooks/useCategories";
import { useSortableTable } from "../hooks/useSortableTable";
import {
  useEarliestTransactionDate,
  useSearchTransactions,
  useTransactions,
  useUpdateTransactionCategory,
} from "../hooks/useTransactions";
import { formatDate, formatMoney } from "../lib/format";
import { parseIsoDate, periodFor, periodToRange, type Period } from "../lib/period";

export function TransactionsPage() {
  const [period, setPeriod] = useState<Period>(() => periodFor("month"));
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [accountId, setAccountId] = useState<string | undefined>();
  const [grouped, setGrouped] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const { from, to } = periodToRange(period);
  const { data: transactions, isLoading } = useTransactions({ from, to, categoryId, accountId });
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
        <h2>Transactions</h2>
        <div style={{ marginBottom: 16 }}>
          <PeriodPicker value={period} onChange={setPeriod} allTimeStart={allTimeStart} />
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
            Account
            <select
              value={accountId ?? ""}
              onChange={(e) => setAccountId(e.target.value || undefined)}
            >
              <option value="">All accounts</option>
              {(accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              value={categoryId ?? ""}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">All categories</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label style={{ flexDirection: "row", gap: 6, alignItems: "center", marginBottom: 16 }}>
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
          Group by description
        </label>

        {isLoading ? (
          <p className="muted">Loading…</p>
        ) : grouped ? (
          <GroupedTransactionList transactions={transactions ?? []} categories={categories ?? []} />
        ) : (
          <TransactionsTable
            transactions={transactions ?? []}
            categories={categories ?? []}
            onCategorize={(id, catId) => updateCategory.mutate({ id, categoryId: catId, createRule: true })}
          />
        )}
      </div>

      {uncategorizedGroups && uncategorizedGroups.length > 0 && (
        <div className="card">
          <h2>Categorize</h2>
          <UncategorizedGroupsTable
            groups={uncategorizedGroups}
            categories={categories ?? []}
            onAssign={(key, categoryId) => bulkAssign.mutate({ key, categoryId })}
          />
        </div>
      )}

      <CategoryRulesPanel categories={categories ?? []} />

      <div className="card">
        <h2>Search &amp; categorize</h2>
        <p className="muted">
          Search across all transactions, any period — a fast way to label a vendor everywhere at
          once.
        </p>
        <input
          type="text"
          placeholder="Search descriptions… e.g. uber, airbnb, netflix"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ width: "100%", maxWidth: 420, marginBottom: 16 }}
        />
        {searchQuery.trim() &&
          (isSearching ? (
            <p className="muted">Searching…</p>
          ) : (
            <GroupedTransactionList transactions={searchResults ?? []} categories={categories ?? []} />
          ))}
      </div>
    </div>
  );
}

function CategoryRulesPanel(props: { categories: Category[] }) {
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
        <h2 style={{ margin: 0 }}>Category rules</h2>
        <button className="link-button" onClick={() => setOpen((o) => !o)}>
          {open ? <FiChevronDown /> : <FiChevronRight />} ({rules?.length ?? 0})
        </button>
      </div>
      {open && (
        <>
          <p className="muted" style={{ marginTop: 12 }}>
            Auto-applied to every new transaction at sync time, matched in insertion order against
            the normalized description. Created whenever you (or the assistant, via MCP) categorize
            a group or reclassify a pattern — or add one yourself below. Adding a rule here only
            affects future transactions; it doesn't retroactively reclassify existing ones.
          </p>

          <form
            onSubmit={submitNewRule}
            style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", marginBottom: 16 }}
          >
            <label>
              Match text
              <input
                type="text"
                placeholder="e.g. netflix"
                value={newMatchText}
                onChange={(e) => setNewMatchText(e.target.value)}
              />
            </label>
            <label>
              Category
              <CategorySelect
                categories={props.categories}
                value={newCategoryId}
                placeholder="Choose category…"
                onChange={setNewCategoryId}
              />
            </label>
            <button type="submit">
              <FiPlus /> Add rule
            </button>
          </form>

          <input
            type="text"
            placeholder="Search rules by match text or category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", maxWidth: 420, marginBottom: 12 }}
          />

          {sorted.length === 0 ? (
            <p className="muted">
              {search.trim() ? "No rules match your search." : "No rules yet."}
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <SortableTh label="Match text" sortKey="matchText" activeKey={sortKey} direction={direction} onSort={toggleSort} />
                  <SortableTh label="Category" sortKey="category" activeKey={sortKey} direction={direction} onSort={toggleSort} />
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id}>
                    <td>{r.match_text}</td>
                    <td>{r.category_name}</td>
                    <td>
                      <button className="danger icon" onClick={() => deleteRule.mutate(r.id)} title="Delete">
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

function UncategorizedGroupsTable(props: {
  groups: { key: string; sampleDescription: string; count: number; totalAmount: number }[];
  categories: Category[];
  onAssign: (key: string, categoryId: number) => void;
}) {
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
          <SortableTh label="Description" sortKey="description" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <SortableTh label="Count" sortKey="count" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <SortableTh label="Total" sortKey="total" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <th>Assign to</th>
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
                placeholder="Choose category…"
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
          <SortableTh label="Date" sortKey="date" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <SortableTh label="Description" sortKey="description" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <SortableTh label="Amount" sortKey="amount" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <SortableTh label="Category" sortKey="category" activeKey={sortKey} direction={direction} onSort={toggleSort} />
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
