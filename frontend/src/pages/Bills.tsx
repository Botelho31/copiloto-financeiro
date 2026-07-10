import { type FormEvent, type ReactNode, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FiCheck, FiChevronDown, FiChevronRight, FiEdit2, FiPlus, FiTrash2, FiX } from "react-icons/fi";
import { CategorySelect } from "../components/CategorySelect";
import { SortableTh } from "../components/SortableTh";
import { useCategories } from "../hooks/useCategories";
import { useSortableTable } from "../hooks/useSortableTable";
import { useBills, useCreateBill, useDeleteBill, useUpdateBill } from "../hooks/useBills";
import { useProjections } from "../hooks/useProjections";
import { formatMoney, formatMonthLabel } from "../lib/format";
import type { Bill, Category } from "shared";

const CADENCES = ["weekly", "monthly", "quarterly", "yearly", "once"] as const;
type Cadence = (typeof CADENCES)[number];

const PROJECTION_HORIZON = 4;

const COLUMN_COUNT = 6;

const isIncomeBill = (b: Bill) => b.category_kind === "income";

// "Past / settled" mirrors the projection engine's own dead-weight rule
// (billAppliesToMonth in shared/src/billCadence.ts): a `once` bill whose due
// date has passed never projects forward again, and a recurring bill is
// settled once its recurrence-end date is behind us. A recurring bill with no
// end date is perpetually upcoming.
function isPastBill(b: Bill): boolean {
  const now = new Date();
  if (b.cadence === "once") {
    return b.next_due_date != null && new Date(b.next_due_date) < now;
  }
  return b.recurrence_end_date != null && new Date(b.recurrence_end_date) < now;
}

type CadenceFilter = "all" | "recurring" | "once";
type TimeFilter = "all" | "upcoming" | "past";
type DebtFilter = "all" | "linked" | "standalone";

function Swatch(props: { color: string }) {
  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: props.color,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

interface BillFormValues {
  name: string;
  categoryId: number | null;
  expectedAmount: number;
  cadence: Cadence;
  nextDueDate: string | null;
  recurrenceStartDate: string | null;
  recurrenceEndDate: string | null;
  isCardExpense: boolean;
}

function BillForm(props: {
  categories: Category[];
  initial?: Bill;
  submitLabel: ReactNode;
  busy?: boolean;
  onSubmit: (values: BillFormValues) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation("bills");
  const b = props.initial;
  const [name, setName] = useState(b?.name ?? "");
  const [categoryId, setCategoryId] = useState<number | null>(b?.category_id ?? null);
  const [expectedAmount, setExpectedAmount] = useState(b ? String(b.expected_amount) : "");
  const [cadence, setCadence] = useState<Cadence>(b?.cadence ?? "monthly");
  const [nextDueDate, setNextDueDate] = useState(b?.next_due_date ?? "");
  const [recurrenceStartDate, setRecurrenceStartDate] = useState(b?.recurrence_start_date ?? "");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(b?.recurrence_end_date ?? "");
  const [isCardExpense, setIsCardExpense] = useState(b?.is_card_expense ?? false);
  // Open by default when the bill already uses one of the tucked-away fields,
  // so editing never hides a value that's actually set.
  const [moreOpen, setMoreOpen] = useState(
    Boolean(b && (b.recurrence_start_date || b.recurrence_end_date || b.is_card_expense))
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name || !expectedAmount) return;
    props.onSubmit({
      name,
      categoryId,
      expectedAmount: Number(expectedAmount),
      cadence,
      nextDueDate: nextDueDate || null,
      recurrenceStartDate: cadence === "once" ? null : recurrenceStartDate || null,
      recurrenceEndDate: cadence === "once" ? null : recurrenceEndDate || null,
      isCardExpense,
    });
  }

  return (
    <form onSubmit={submit} className="grid" style={{ gap: 12 }}>
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}
      >
        <label>
          {t("form.name")}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {t("form.category")}
          <CategorySelect
            categories={props.categories}
            value={categoryId}
            placeholder={t("form.categoryPlaceholder")}
            onChange={setCategoryId}
          />
        </label>
        <label>
          {t("form.amount")}
          <input
            type="number"
            step="0.01"
            value={expectedAmount}
            onChange={(e) => setExpectedAmount(e.target.value)}
            required
          />
        </label>
        <label>
          {t("form.cadence")}
          <select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {t(`cadences.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("form.nextDueDate")}
          <input type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} />
        </label>
      </div>

      <div>
        <button type="button" className="link-button" onClick={() => setMoreOpen((o) => !o)}>
          {moreOpen ? <FiChevronDown /> : <FiChevronRight />} {t("form.moreOptions")}
        </button>
      </div>

      {moreOpen && (
        <div
          className="grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
            alignItems: "end",
          }}
        >
          {cadence !== "once" && (
            <>
              <label>
                {t("form.recurrenceStart")}
                <input
                  type="date"
                  value={recurrenceStartDate}
                  onChange={(e) => setRecurrenceStartDate(e.target.value)}
                />
              </label>
              <label>
                {t("form.recurrenceEnd")}
                <input
                  type="date"
                  value={recurrenceEndDate}
                  onChange={(e) => setRecurrenceEndDate(e.target.value)}
                />
              </label>
            </>
          )}
          <label
            style={{ flexDirection: "row", gap: 6, alignItems: "center" }}
            title={t("form.cardExpenseHint")}
          >
            <input
              type="checkbox"
              checked={isCardExpense}
              onChange={(e) => setIsCardExpense(e.target.checked)}
            />
            {t("form.cardExpense")}
          </label>
        </div>
      )}

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

function EditBillRow(props: {
  bill: Bill;
  categories: Category[];
  onDone: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation("bills");
  const updateBill = useUpdateBill();
  return (
    <tr>
      <td colSpan={COLUMN_COUNT} style={{ padding: "16px 12px", background: "var(--ink)" }}>
        <BillForm
          initial={props.bill}
          categories={props.categories}
          submitLabel={
            <>
              <FiCheck /> {t("editForm.submit")}
            </>
          }
          busy={updateBill.isPending}
          onCancel={props.onDone}
          onSubmit={(v) =>
            updateBill.mutate(
              {
                id: props.bill.id,
                input: {
                  name: v.name,
                  categoryId: v.categoryId,
                  expectedAmount: v.expectedAmount,
                  cadence: v.cadence,
                  nextDueDate: v.nextDueDate,
                  recurrenceStartDate: v.recurrenceStartDate,
                  recurrenceEndDate: v.recurrenceEndDate,
                  isCardExpense: v.isCardExpense,
                },
              },
              {
                onSuccess: () => {
                  props.onSaved();
                  props.onDone();
                },
              }
            )
          }
        />
      </td>
    </tr>
  );
}

function BillTable(props: {
  bills: Bill[];
  pending: boolean;
  categories: Category[];
  onConfirm?: (id: number) => void;
  onDismiss?: (id: number) => void;
  onRemove?: (id: number) => void;
  onSaved?: () => void;
}) {
  const { t } = useTranslation("bills");
  const [editingId, setEditingId] = useState<number | null>(null);
  const { sorted, sortKey, direction, toggleSort } = useSortableTable<Bill>(
    props.bills,
    (b, key) => {
      switch (key) {
        case "category":
          return b.category_name ?? "";
        case "amount":
          // Signed so income and expenses group sensibly in the combined table.
          return (isIncomeBill(b) ? 1 : -1) * b.expected_amount;
        case "cadence":
          return b.cadence;
        case "nextDue":
          return b.next_due_date ?? "";
        default:
          return b.name;
      }
    },
    "name"
  );

  return (
    <table>
      <thead>
        <tr>
          <SortableTh label={t("table.name")} sortKey="name" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <SortableTh label={t("table.category")} sortKey="category" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <SortableTh label={t("table.amount")} sortKey="amount" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <SortableTh label={t("table.cadence")} sortKey="cadence" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <SortableTh label={t("table.nextDue")} sortKey="nextDue" activeKey={sortKey} direction={direction} onSort={toggleSort} />
          <th />
        </tr>
      </thead>
      <tbody>
        {sorted.map((b) => {
          if (editingId === b.id) {
            return (
              <EditBillRow
                key={b.id}
                bill={b}
                categories={props.categories}
                onDone={() => setEditingId(null)}
                onSaved={() => props.onSaved?.()}
              />
            );
          }
          const income = isIncomeBill(b);
          const categoryColor = props.categories.find((c) => c.id === b.category_id)?.color;
          return (
            <tr key={b.id}>
              <td>
                {b.name}
                {b.is_card_expense && (
                  <span className="badge" title={t("form.cardExpenseHint")} style={{ marginLeft: 8 }}>
                    {t("table.cardBadge")}
                  </span>
                )}
                {b.debt_name && (
                  <span
                    className="badge"
                    title={t("table.debtBadgeTitle", { debtName: b.debt_name })}
                    style={{ marginLeft: 8 }}
                  >
                    → {b.debt_name}
                  </span>
                )}
              </td>
              <td>
                {b.category_name ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {categoryColor && <Swatch color={categoryColor} />}
                    {b.category_name}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className={`money ${income ? "gain" : "shortfall"}`}>
                {income ? "+" : "-"}
                {formatMoney(b.expected_amount)}
              </td>
              <td>
                {t(`cadences.${b.cadence}`)}
                {b.cadence !== "once" && (b.recurrence_start_date || b.recurrence_end_date) && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {b.recurrence_start_date ?? "…"} → {b.recurrence_end_date ?? "…"}
                  </div>
                )}
              </td>
              <td>{b.next_due_date ?? "—"}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {props.pending ? (
                  <>
                    <button className="icon" onClick={() => props.onConfirm?.(b.id)} title={t("table.confirm")}>
                      <FiCheck />
                    </button>{" "}
                    <button className="secondary icon" onClick={() => props.onDismiss?.(b.id)} title={t("table.dismiss")}>
                      <FiX />
                    </button>
                  </>
                ) : (
                  <>
                    <button className="secondary icon" onClick={() => setEditingId(b.id)} title={t("table.edit")}>
                      <FiEdit2 />
                    </button>{" "}
                    <button className="danger icon" onClick={() => props.onRemove?.(b.id)} title={t("table.remove")}>
                      <FiTrash2 />
                    </button>
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ProjectedByCategory(props: { bills: Bill[]; categories: Category[] }) {
  const { t } = useTranslation("bills");
  const { data: projections } = useProjections(PROJECTION_HORIZON);
  const months = (projections?.months ?? []).slice(0, PROJECTION_HORIZON);
  const billById = new Map(props.bills.map((b) => [b.id, b]));

  interface CategoryRow {
    name: string;
    color?: string;
    totals: number[];
  }
  const rows = new Map<string, CategoryRow>();
  months.forEach((month, mi) => {
    // cardExpenseBills are kept out of a month's own bill lines so the
    // Projections page doesn't double-count them against the card-spend
    // goal, but per category they're still real upcoming charges — same
    // merge the Dashboard's expectedBreakdown makes. A debt line driven by
    // its payment bill carries that bill's id, so it stays attributable to
    // the bill's category here even though the line belongs to the debt.
    const lines = [
      ...month.bills
        .filter((l) => l.kind === "bill" || (l.kind === "debt" && l.billId != null))
        .map((l) => ({ id: l.kind === "debt" ? l.billId! : l.id, amount: l.amount })),
      ...month.cardExpenseBills,
    ];
    for (const line of lines) {
      const bill = billById.get(line.id);
      const key = bill?.category_name ?? t("projected.uncategorized");
      let row = rows.get(key);
      if (!row) {
        row = {
          name: key,
          color: props.categories.find((c) => c.id === bill?.category_id)?.color,
          totals: months.map(() => 0),
        };
        rows.set(key, row);
      }
      row.totals[mi] += line.amount;
    }
  });

  const sortedRows = [...rows.values()].sort((a, b) => {
    const sumA = a.totals.reduce((s, v) => s + v, 0);
    const sumB = b.totals.reduce((s, v) => s + v, 0);
    if (sumA >= 0 !== sumB >= 0) return sumA >= 0 ? -1 : 1;
    return Math.abs(sumB) - Math.abs(sumA);
  });
  const netTotals = months.map((_, mi) => sortedRows.reduce((sum, row) => sum + row.totals[mi], 0));

  if (!projections) return <p className="muted">{t("projected.loading")}</p>;
  if (sortedRows.length === 0) {
    return <p className="muted">{t("projected.empty")}</p>;
  }

  const cell = (value: number, key: string | number) => (
    <td key={key} className={`money ${value > 0 ? "gain" : value < 0 ? "shortfall" : ""}`}>
      {value === 0 ? <span className="muted">—</span> : `${value > 0 ? "+" : "-"}${formatMoney(Math.abs(value))}`}
    </td>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>{t("projected.category")}</th>
            {months.map((m) => (
              <th key={m.label}>{formatMonthLabel(m.label)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={row.name}>
              <td>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {row.color && <Swatch color={row.color} />}
                  {row.name}
                </span>
              </td>
              {row.totals.map((v, i) => cell(v, i))}
            </tr>
          ))}
          <tr>
            <td style={{ fontWeight: 600 }}>{t("projected.netRecurring")}</td>
            {netTotals.map((v, i) => cell(v, i))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function BillsPage() {
  const { t } = useTranslation("bills");
  const { data: bills } = useBills();
  const { data: categories } = useCategories();
  const createBill = useCreateBill();
  const updateBill = useUpdateBill();
  const deleteBill = useDeleteBill();
  const queryClient = useQueryClient();
  // The bill hooks only invalidate ["bills"]; the by-category table below
  // reads ["projections"], which would otherwise sit stale until refocus.
  const refreshProjections = () =>
    queryClient.invalidateQueries({ queryKey: ["projections"] });

  const [view, setView] = useState<"all" | "income" | "bills">("all");
  const [search, setSearch] = useState("");
  const [cadenceFilter, setCadenceFilter] = useState<CadenceFilter>("all");
  // Default to "upcoming": past/settled entries are dead weight in the list
  // (same items the projection engine already stops projecting) — the point of
  // the filter row is to shed them. "Past" and "All" are one select away.
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("upcoming");
  const [debtFilter, setDebtFilter] = useState<DebtFilter>("all");
  // Remounting the form is how "clear on successful add" works, since
  // BillForm owns its own field state.
  const [formKey, setFormKey] = useState(0);
  const [pendingOpen, setPendingOpen] = useState(false);

  const all = bills ?? [];
  const pending = all.filter((b) => !b.confirmed);
  const active = all.filter((b) => b.confirmed && b.active);

  const query = search.trim().toLowerCase();
  const filtered = active.filter((b) => {
    if (query) {
      const haystack = `${b.name} ${b.category_name ?? ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (cadenceFilter === "recurring" && b.cadence === "once") return false;
    if (cadenceFilter === "once" && b.cadence !== "once") return false;
    if (timeFilter !== "all") {
      const past = isPastBill(b);
      if (timeFilter === "upcoming" && past) return false;
      if (timeFilter === "past" && !past) return false;
    }
    if (debtFilter === "linked" && b.debt_id == null) return false;
    if (debtFilter === "standalone" && b.debt_id != null) return false;
    return true;
  });

  const filteredIncome = filtered.filter(isIncomeBill);
  const filteredBills = filtered.filter((b) => !isIncomeBill(b));
  const shown = view === "income" ? filteredIncome : view === "bills" ? filteredBills : filtered;
  const hasActiveFilters =
    query !== "" || cadenceFilter !== "all" || timeFilter !== "all" || debtFilter !== "all";

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="card">
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <h2 style={{ margin: 0 }}>{t("title")}</h2>
          <div className="toggle-group">
            <button className={view === "all" ? "active" : ""} onClick={() => setView("all")}>
              {t("tabs.all", { count: filtered.length })}
            </button>
            <button className={view === "income" ? "active" : ""} onClick={() => setView("income")}>
              {t("tabs.income", { count: filteredIncome.length })}
            </button>
            <button className={view === "bills" ? "active" : ""} onClick={() => setView("bills")}>
              {t("tabs.bills", { count: filteredBills.length })}
            </button>
          </div>
        </div>
        <p className="muted">{t("subtitle")}</p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "end",
            marginBottom: 16,
          }}
        >
          <label style={{ flex: "1 1 220px", minWidth: 180 }}>
            {t("filters.search")}
            <input
              type="text"
              placeholder={t("filters.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            {t("filters.cadence")}
            <select
              value={cadenceFilter}
              onChange={(e) => setCadenceFilter(e.target.value as CadenceFilter)}
            >
              <option value="all">{t("filters.cadenceOptions.all")}</option>
              <option value="recurring">{t("filters.cadenceOptions.recurring")}</option>
              <option value="once">{t("filters.cadenceOptions.once")}</option>
            </select>
          </label>
          <label>
            {t("filters.time")}
            <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}>
              <option value="upcoming">{t("filters.timeOptions.upcoming")}</option>
              <option value="past">{t("filters.timeOptions.past")}</option>
              <option value="all">{t("filters.timeOptions.all")}</option>
            </select>
          </label>
          <label>
            {t("filters.debtLink")}
            <select value={debtFilter} onChange={(e) => setDebtFilter(e.target.value as DebtFilter)}>
              <option value="all">{t("filters.debtLinkOptions.all")}</option>
              <option value="linked">{t("filters.debtLinkOptions.linked")}</option>
              <option value="standalone">{t("filters.debtLinkOptions.standalone")}</option>
            </select>
          </label>
        </div>
        {shown.length > 0 ? (
          <BillTable
            bills={shown}
            pending={false}
            categories={categories ?? []}
            onRemove={(id) => deleteBill.mutate(id, { onSuccess: refreshProjections })}
            onSaved={refreshProjections}
          />
        ) : hasActiveFilters || active.length > 0 ? (
          <p className="muted">{t("empty.noMatches")}</p>
        ) : (
          <p className="muted">{t("empty.noneYet")}</p>
        )}
      </div>

      <div className="card">
        <h2>{t("projected.title")}</h2>
        <p className="muted">{t("projected.subtitle")}</p>
        <ProjectedByCategory bills={all} categories={categories ?? []} />
      </div>

      <div className="card">
        <h2>{t("addForm.title")}</h2>
        <p className="muted">{t("addForm.subtitle")}</p>
        <BillForm
          key={formKey}
          categories={categories ?? []}
          submitLabel={
            <>
              <FiPlus /> {t("addForm.submit")}
            </>
          }
          busy={createBill.isPending}
          onSubmit={(v) =>
            createBill.mutate(
              {
                name: v.name,
                categoryId: v.categoryId ?? undefined,
                expectedAmount: v.expectedAmount,
                cadence: v.cadence,
                nextDueDate: v.nextDueDate ?? undefined,
                recurrenceStartDate: v.recurrenceStartDate ?? undefined,
                recurrenceEndDate: v.recurrenceEndDate ?? undefined,
                isCardExpense: v.isCardExpense,
              },
              {
                onSuccess: () => {
                  refreshProjections();
                  setFormKey((k) => k + 1);
                },
              }
            )
          }
        />
      </div>

      {pending.length > 0 && (
        <div className="card">
          <button className="disclosure" onClick={() => setPendingOpen((o) => !o)}>
            {pendingOpen ? <FiChevronDown /> : <FiChevronRight />} {t("pending.toggle", { count: pending.length })}
          </button>
          {pendingOpen && (
            <div style={{ marginTop: 12 }}>
              <p className="muted">{t("pending.hint")}</p>
              <BillTable
                bills={pending}
                pending
                categories={categories ?? []}
                onConfirm={(id) =>
                  updateBill.mutate({ id, input: { confirmed: true } }, { onSuccess: refreshProjections })
                }
                onDismiss={(id) =>
                  updateBill.mutate({ id, input: { active: false } }, { onSuccess: refreshProjections })
                }
                onSaved={refreshProjections}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
