import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  FiArrowLeft,
  FiChevronDown,
  FiChevronRight,
  FiLink,
  FiPlus,
  FiTrash2,
} from "react-icons/fi";
import { MdLinkOff } from "react-icons/md";
import {
  Area,
  Bar,
  BarChart,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Bill, Debt, DebtLinkedTransaction } from "shared";
import { addMonthsIso, simulateAmortization } from "shared";
import {
  useCreateDebt,
  useDebtTransactions,
  useDebts,
  useDeleteDebt,
  useLinkDebtToDebt,
  useLinkTransactionsToDebt,
  useUnlinkDebtFromDebt,
  useUnlinkTransactionsFromDebt,
  useUpdateDebt,
} from "../hooks/useDebts";
import { useBills, useUpdateBill } from "../hooks/useBills";
import { useProjections } from "../hooks/useProjections";
import { useSearchTransactions } from "../hooks/useTransactions";
import { useSortableTable } from "../hooks/useSortableTable";
import { SortableTh } from "../components/SortableTh";
import { formatDate, formatMoney, formatMonthLabel } from "../lib/format";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used only via `typeof ... [number]` below
const DIRECTION_VALUES = ["owed_by_me", "owed_to_me"] as const;
function directionOptions(t: TFunction<"debts">) {
  return [
    { value: "owed_by_me" as const, label: t("directions.owedByMe") },
    { value: "owed_to_me" as const, label: t("directions.owedToMe") },
  ];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used only via `typeof ... [number]` below
const LOAN_TYPE_VALUES = ["", "price", "sac"] as const;
function loanTypeOptions(t: TFunction<"debts">) {
  return [
    { value: "" as const, label: t("loanTypeOptions.none") },
    { value: "price" as const, label: t("loanTypeOptions.price") },
    { value: "sac" as const, label: t("loanTypeOptions.sac") },
  ];
}

// "PRICE"/"SAC" are standard Brazilian amortization-system names, identical
// in Portuguese and English — not translated.
const LOAN_TYPE_LABEL: Record<"price" | "sac", string> = { price: "PRICE", sac: "SAC" };

function isFutureDebt(d: Debt): boolean {
  return d.status === "active" && d.start_date > new Date().toISOString().slice(0, 10);
}

function roleOptions(t: TFunction<"debts">) {
  return [
    { value: "borrow" as const, label: t("roles.borrow") },
    { value: "lend" as const, label: t("roles.lend") },
    { value: "pay_off" as const, label: t("roles.payOff") },
  ];
}

function ProgressBar(props: { percent: number; tone: "positive" | "negative" }) {
  const pct = Math.min(100, Math.max(0, props.percent * 100));
  return (
    <div style={{ background: "var(--rule)", height: 8, borderRadius: 4, overflow: "hidden" }}>
      <div
        style={{
          width: `${pct}%`,
          background: props.tone === "negative" ? "var(--danger)" : "var(--accent)",
          height: "100%",
        }}
      />
    </div>
  );
}

function DebtLinker(props: { debtId: number; startDate: string; linkedIds: Set<string> }) {
  const { t } = useTranslation(["debts", "common"]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [role, setRole] = useState<"borrow" | "lend" | "pay_off">("pay_off");

  useEffect(() => {
    const timeoutId = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timeoutId);
  }, [query]);

  const { data: rawResults, isFetching } = useSearchTransactions(debouncedQuery);
  const filteredResults = (rawResults ?? []).filter(
    (tx) => tx.date >= props.startDate && !props.linkedIds.has(tx.id)
  );
  const {
    sorted: results,
    sortKey,
    direction,
    toggleSort,
  } = useSortableTable(
    filteredResults,
    (tx, key) => (key === "date" ? tx.date : key === "description" ? tx.description : tx.amount),
    "date",
    "desc"
  );
  const link = useLinkTransactionsToDebt();

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder={t("linker.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "borrow" | "lend" | "pay_off")}
        >
          {roleOptions(t).map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      {debouncedQuery.trim() &&
        (isFetching ? (
          <p className="muted">{t("linker.searching")}</p>
        ) : results.length === 0 ? (
          <p className="muted">{t("linker.noMatches")}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <SortableTh
                  label={t("common:table.date")}
                  sortKey="date"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={toggleSort}
                />
                <SortableTh
                  label={t("common:table.description")}
                  sortKey="description"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={toggleSort}
                />
                <SortableTh
                  label={t("common:table.amount")}
                  sortKey="amount"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={toggleSort}
                />
                <th />
              </tr>
            </thead>
            <tbody>
              {results.map((tx) => (
                <tr key={tx.id}>
                  <td>{formatDate(tx.date)}</td>
                  <td>{tx.description}</td>
                  <td className="money">{formatMoney(tx.amount, tx.currency_code)}</td>
                  <td>
                    <button
                      className="link-button"
                      onClick={() =>
                        link.mutate({ debtId: props.debtId, transactionIds: [tx.id], role })
                      }
                      title={t("linker.linkTitle")}
                    >
                      <FiLink />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </div>
  );
}

function InterestRateEditor(props: { debt: Debt; payOffTx: DebtLinkedTransaction[] }) {
  const { t } = useTranslation("debts");
  const updateDebt = useUpdateDebt();
  const [value, setValue] = useState(
    () => props.debt.interest_rate_monthly_percent?.toString() ?? ""
  );

  useEffect(() => {
    setValue(props.debt.interest_rate_monthly_percent?.toString() ?? "");
  }, [props.debt.interest_rate_monthly_percent]);

  const typedRate = value.trim() === "" ? null : Number(value.trim());
  const isDirty = typedRate !== props.debt.interest_rate_monthly_percent;
  const annualRate = typedRate != null && !Number.isNaN(typedRate) ? typedRate * 12 : null;

  const preview = useMemo(() => {
    if (typedRate == null || Number.isNaN(typedRate) || props.debt.principal <= 0) return null;
    return simulateAmortization(
      props.debt.principal,
      typedRate,
      props.debt.start_date,
      props.payOffTx.map((tx) => ({ id: tx.id, date: tx.date, amount: Math.abs(tx.amount) }))
    );
  }, [typedRate, props.debt.principal, props.debt.start_date, props.payOffTx]);

  function save() {
    const trimmed = value.trim();
    const num = trimmed === "" ? null : Number(trimmed);
    if (num === props.debt.interest_rate_monthly_percent) return;
    updateDebt.mutate({ id: props.debt.id, input: { interestRateMonthlyPercent: num } });
  }

  return (
    <div>
      <div className="label muted">{t("interestRate.label")}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="number"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="0"
          style={{ width: 90 }}
          className="money"
        />
        <span className="muted">{t("interestRate.unit")}</span>
        {annualRate != null && (
          <span className="muted" style={{ fontSize: "0.85em" }}>
            {t("interestRate.annual", { rate: annualRate.toFixed(2) })}
          </span>
        )}
      </div>
      {isDirty && preview && (
        <div className="muted" style={{ fontSize: "0.85em", marginTop: 4 }}>
          {t("interestRate.preview", {
            remaining: formatMoney(preview.currentPayoffBalance),
            interest: formatMoney(preview.interestAccruedSinceLastPayment),
            total: formatMoney(preview.totalInterestPaid),
          })}
        </div>
      )}
    </div>
  );
}

// Only meaningful for a formal amortizing loan (a mortgage) — set alongside
// an interest rate and target payoff date, this is what lets the projection
// engine compute an expected monthly payment straight from the loan formula
// instead of needing real payment history to infer one from.
function LoanTypeEditor(props: { debt: Debt }) {
  const { t } = useTranslation("debts");
  const updateDebt = useUpdateDebt();

  function save(value: string) {
    updateDebt.mutate({
      id: props.debt.id,
      input: { loanType: value === "" ? null : (value as "price" | "sac") },
    });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div className="label muted">{t("loanType.label")}</div>
      <select value={props.debt.loan_type ?? ""} onChange={(e) => save(e.target.value)}>
        {loanTypeOptions(t).map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function StartDateEditor(props: { debt: Debt }) {
  const { t } = useTranslation("debts");
  const updateDebt = useUpdateDebt();
  const [value, setValue] = useState(props.debt.start_date);

  useEffect(() => {
    setValue(props.debt.start_date);
  }, [props.debt.start_date]);

  function save() {
    if (!value || value === props.debt.start_date) return;
    updateDebt.mutate({ id: props.debt.id, input: { startDate: value } });
  }

  return (
    <div>
      <div className="label muted">{t("startDate.label")}</div>
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        className="money"
      />
      {isFutureDebt(props.debt) && (
        <span className="muted" style={{ fontSize: 12 }}>
          {t("startDate.future")}
        </span>
      )}
    </div>
  );
}

// Editable only for a fixed-amount debt — a split-percentage debt's
// principal is derived from linked transactions/other debts, not a value of
// its own to type in.
function PrincipalEditor(props: { debt: Debt }) {
  const { t } = useTranslation("debts");
  const updateDebt = useUpdateDebt();
  const d = props.debt;
  const [value, setValue] = useState(String(d.principal_amount ?? ""));

  useEffect(() => {
    setValue(String(d.principal_amount ?? ""));
  }, [d.principal_amount]);

  if (d.split_percentage != null) {
    return (
      <div>
        <div className="label muted">{t("principal.label")}</div>
        <div className="money">{formatMoney(d.principal)}</div>
      </div>
    );
  }

  function save() {
    const trimmed = value.trim();
    const num = trimmed === "" ? null : Number(trimmed);
    if (num === d.principal_amount) return;
    updateDebt.mutate({ id: d.id, input: { principalAmount: num } });
  }

  return (
    <div>
      <div className="label muted">{t("principal.label")}</div>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        className="money"
        style={{ width: 130 }}
      />
    </div>
  );
}

function MatchingRuleEditor(props: { debt: Debt }) {
  const { t } = useTranslation("debts");
  const updateDebt = useUpdateDebt();
  const [value, setValue] = useState(props.debt.matching_rule ?? "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setValue(props.debt.matching_rule ?? "");
  }, [props.debt.matching_rule]);

  function save() {
    const trimmed = value.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next === (props.debt.matching_rule ?? null)) return;
    updateDebt.mutate({ id: props.debt.id, input: { matchingRule: next } });
  }

  return (
    <div>
      <button
        className="link-button"
        onClick={() => setOpen((o) => !o)}
        style={{ alignSelf: "start" }}
      >
        {open ? <FiChevronDown /> : <FiChevronRight />} {t("matchingRule.toggle")}
        {props.debt.matching_rule ? "" : t("matchingRule.notSet")}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div className="label muted">{t("matchingRule.label")}</div>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={save}
            placeholder={t("matchingRule.placeholder")}
            rows={2}
            style={{ width: "100%", resize: "vertical" }}
          />
        </div>
      )}
    </div>
  );
}

function LinkedDebtsEditor(props: { debt: Debt; allDebts: Debt[] }) {
  const { t } = useTranslation("debts");
  const linkDebt = useLinkDebtToDebt();
  const unlinkDebt = useUnlinkDebtFromDebt();
  const [selectedChildId, setSelectedChildId] = useState("");
  const [open, setOpen] = useState(false);

  const linkableDebts = props.allDebts.filter(
    (other) =>
      other.id !== props.debt.id && !props.debt.linked_debts.some((ld) => ld.id === other.id)
  );

  return (
    <div>
      <button
        className="link-button"
        onClick={() => setOpen((o) => !o)}
        style={{ alignSelf: "start" }}
      >
        {open ? <FiChevronDown /> : <FiChevronRight />}{" "}
        {t("linkedDebts.toggle", { count: props.debt.linked_debts.length })}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div className="label muted">{t("linkedDebts.label")}</div>
          {props.debt.linked_debts.length > 0 && (
            <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
              {props.debt.linked_debts.map((ld) => (
                <li key={ld.id}>
                  {ld.name} ({formatMoney(ld.principal)}
                  {!ld.countsTowardOrigin && (
                    <span className="muted" title={t("linkedDebts.notCountedYetTitle")}>
                      {" "}
                      · {t("linkedDebts.notCountedYet")}
                    </span>
                  )}
                  ){" "}
                  <button
                    className="link-button"
                    onClick={() =>
                      unlinkDebt.mutate({ parentDebtId: props.debt.id, childDebtId: ld.id })
                    }
                    title={t("linkedDebts.unlinkTitle")}
                  >
                    <MdLinkOff />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {linkableDebts.length > 0 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
              <select value={selectedChildId} onChange={(e) => setSelectedChildId(e.target.value)}>
                <option value="">{t("linkedDebts.selectPlaceholder")}</option>
                {linkableDebts.map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.name}
                  </option>
                ))}
              </select>
              <button
                className="link-button"
                disabled={!selectedChildId}
                onClick={() => {
                  if (!selectedChildId) return;
                  linkDebt.mutate({
                    parentDebtId: props.debt.id,
                    childDebtId: Number(selectedChildId),
                  });
                  setSelectedChildId("");
                }}
              >
                <FiLink /> {t("linkedDebts.linkButton")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A compact preview — the full detail (interest editor, matching rule,
// linked debts/transactions) only renders for whichever one debt is
// currently selected (see DebtsPage), so a long debt list reads as a
// scannable grid instead of a stack of full-width rectangles.
function DebtTile(props: { debt: Debt; onSelect: () => void }) {
  const { t } = useTranslation("debts");
  const d = props.debt;
  const tone = d.direction === "owed_by_me" ? "negative" : "positive";
  const directionLabel =
    d.direction === "owed_by_me" ? t("direction.owe") : t("direction.owedToMe");

  return (
    <div
      className="card debt-tile"
      role="button"
      tabIndex={0}
      onClick={props.onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onSelect();
        }
      }}
    >
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8 }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>{d.name}</h3>
        <span
          style={{
            color: tone === "negative" ? "var(--danger)" : "var(--accent)",
            fontWeight: 600,
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
        >
          {directionLabel}
        </span>
      </div>
      {d.counterparty && (
        <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
          {d.counterparty}
        </div>
      )}
      {(d.loan_type || isFutureDebt(d)) && (
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          {d.loan_type && <span className="badge">{LOAN_TYPE_LABEL[d.loan_type]}</span>}
          {isFutureDebt(d) && (
            <span className="badge">{t("tile.starts", { date: formatDate(d.start_date) })}</span>
          )}
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <div className="label muted">
          {d.status === "active" ? t("tile.remaining") : t("tile.paid")}
        </div>
        <div className="money" style={{ fontSize: 20 }}>
          {formatMoney(d.status === "active" ? d.remaining : d.total_paid)}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <ProgressBar percent={d.percent_complete} tone={tone} />
      </div>
    </div>
  );
}

// Monthly-equivalent of everything driving the debt's combined plan (every
// linked bill, converted to its own monthly-equivalent, plus the automatic
// heuristic if it's also contributing) — an explicit figure beats a
// historical average anywhere a forecast needs "what will actually be paid
// each month".
function plannedMonthlyPayment(d: Debt): number | null {
  const plan = d.payment_plan;
  if (plan.source === "loan") return plan.monthly_amount;
  if (plan.source !== "combined") return null;
  const billsMonthly = plan.bills.reduce((sum, b) => {
    switch (b.cadence) {
      case "weekly":
        return sum + b.amount * (52 / 12);
      case "monthly":
        return sum + b.amount;
      case "quarterly":
        return sum + b.amount / 3;
      case "yearly":
        return sum + b.amount / 12;
      default:
        // A single one-off payment isn't a monthly pace.
        return sum;
    }
  }, 0);
  const total = billsMonthly + (plan.automatic?.monthly_amount ?? 0);
  return total > 0 ? total : null;
}

// Reads year/month straight off "YYYY-MM-DD" strings, same as
// monthsBetweenDates in backend/src/routes/debts.ts — new Date(iso) parses as
// UTC midnight, which can shift a 1st-of-month date into the previous month
// in a negative-UTC-offset timezone. Purely a presentational month count
// between two already-known dates, not a financial computation.
function monthsBetweenIso(fromDate: string, toDate: string): number {
  const [fromYear, fromMonth] = fromDate.split("-").map(Number);
  const [toYear, toMonth] = toDate.split("-").map(Number);
  return (toYear! - fromYear!) * 12 + (toMonth! - fromMonth!);
}

// Renders the backend's own projected_finish_date/payment_plan directly —
// PaymentPlanSection (above) already explains which basis was used and why;
// this is just "so when does it end." Never re-derives a payoff date or
// monthly pace itself: an earlier version fell back to its own average-
// payment heuristic for loan-type debts (since plannedMonthlyPayment used to
// return null for them) and could show a confident date even when the
// backend's own regularity check (see computePaymentPlan's coefficient-of-
// variation gate) had explicitly decided there wasn't enough basis to
// project — see backend/API-ARCHITECTURE.md's R2 for the incident.
function PayoffProjection(props: { debt: Debt }) {
  const { t } = useTranslation("debts");
  const d = props.debt;

  if (d.status !== "active" || d.remaining <= 0) return null;
  // PaymentPlanSection already renders the "no basis at all" explanation for
  // source === "none" in detail right above this — no need to repeat it here.
  if (d.payment_plan.source === "none") return null;

  const monthlyAmount = plannedMonthlyPayment(d);

  if (d.projected_finish_date == null) {
    // A plan exists but the backend's own walk-forward (computeProjectedBalanceSchedule)
    // never reaches payoff within its ceiling — e.g. the payment doesn't even
    // cover accruing interest. Same authoritative signal as before, just read
    // off the field instead of re-derived by comparing against interest here.
    return (
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--rule)" }}>
        <div className="label muted">{t("payoffProjection.label")}</div>
        <div className="shortfall" style={{ marginTop: 4 }}>
          {t("payoffProjection.shortfall", {
            amount: monthlyAmount != null ? formatMoney(monthlyAmount) : "—",
          })}
        </div>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const months = Math.max(0, monthsBetweenIso(today, d.projected_finish_date));

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--rule)" }}>
      <div className="label muted">{t("payoffProjection.label")}</div>
      <div style={{ marginTop: 4 }}>
        <span style={{ fontWeight: 600 }}>{t("payoffProjection.months", { count: months })}</span>{" "}
        <span className="muted">
          {t("payoffProjection.approxDate", {
            date: new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(
              new Date(d.projected_finish_date)
            ),
          })}
        </span>
      </div>
      {monthlyAmount != null && (
        <div className="muted" style={{ fontSize: "0.85em", marginTop: 2 }}>
          {t("payoffProjection.basedOn", {
            amount: formatMoney(monthlyAmount),
            rate: d.interest_rate_monthly_percent
              ? t("payoffProjection.atRate", { rate: d.interest_rate_monthly_percent })
              : "",
          })}
        </div>
      )}
    </div>
  );
}

// 18 months so even a loan starting next year (e.g. the CAIXA mortgage in
// 2027-07) still shows its upcoming payments; only the first few applicable
// months are displayed.
const PLAN_PREVIEW_HORIZON = 18;
const PLAN_PREVIEW_COUNT = 6;

function cadenceLabel(t: TFunction<"debts">, cadence: Bill["cadence"]): string {
  const labels: Record<Bill["cadence"], string> = {
    weekly: t("cadence.weekly"),
    monthly: t("cadence.monthly"),
    quarterly: t("cadence.quarterly"),
    yearly: t("cadence.yearly"),
    once: t("cadence.once"),
  };
  return labels[cadence];
}

// One bill row in the "Paid by recurring bill(s)" control — used both for the
// bills already linked to this debt (checked, unchecking unlinks) and for the
// picker of candidates (unchecked, checking links). A bill that currently
// pays a DIFFERENT debt says so, since checking it would move it here.
function PlanBillRow(props: {
  bill: Bill;
  linked: boolean;
  first: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const { t } = useTranslation("debts");
  const b = props.bill;
  const linkedElsewhere = !props.linked && b.debt_id !== null;
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderTop: props.first ? undefined : "1px solid var(--rule)",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={props.linked}
        onChange={(e) => props.onToggle(e.target.checked)}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            opacity: linkedElsewhere ? 0.7 : undefined,
          }}
        >
          {b.name}
        </span>
        {linkedElsewhere && (
          <span className="muted" style={{ display: "block", fontSize: 12 }}>
            {t("planBillRow.linkedElsewhere", {
              name: b.debt_name ?? t("planBillRow.anotherDebt"),
            })}
          </span>
        )}
      </span>
      {b.category_name && <span className="badge">{b.category_name}</span>}
      <span
        className={`money ${b.category_kind === "income" ? "gain" : "shortfall"}`}
        style={{ fontSize: 13 }}
      >
        {formatMoney(b.expected_amount)}
      </span>
      <span className="muted" style={{ fontSize: 12, minWidth: 64, textAlign: "right" }}>
        {cadenceLabel(t, b.cadence)}
      </span>
    </label>
  );
}

// The explicit answer to "how is this debt's payment calculated" — states the
// resolved method in plain terms, previews the coming months straight from
// the projection engine (the same numbers the Projections page shows, not a
// separately computed version), and holds the one control that changes it:
// which recurring bill pays this debt down.
function PaymentPlanSection(props: { debt: Debt }) {
  const { t } = useTranslation("debts");
  const d = props.debt;
  const plan = d.payment_plan;
  const { data: bills } = useBills();
  const { data: projections } = useProjections(PLAN_PREVIEW_HORIZON);
  const updateDebt = useUpdateDebt();
  const updateBill = useUpdateBill();

  // Only confirmed, active, non-card bills can act as a schedule — but any
  // bill already linked to THIS debt stays listed even if it no longer
  // qualifies, so unchecking it is always possible.
  const linkableBills = (bills ?? []).filter(
    (b) => (b.confirmed && b.active && !b.is_card_expense) || b.debt_id === d.id
  );

  // Typically only 1-3 of the linkable bills actually pay this debt, so the
  // linked ones get their own always-visible list; everything else lives in
  // a collapsed, filterable picker instead of one long undifferentiated list.
  const [billPickerOpen, setBillPickerOpen] = useState(false);
  const [billFilter, setBillFilter] = useState("");
  const linkedBills = linkableBills.filter((b) => b.debt_id === d.id);
  const candidateBills = linkableBills
    .filter((b) => b.debt_id !== d.id)
    // Free bills first, then ones that would be moved off another debt.
    .sort(
      (a, b) =>
        Number(a.debt_id !== null) - Number(b.debt_id !== null) || a.name.localeCompare(b.name)
    );
  const billQuery = billFilter.trim().toLowerCase();
  const visibleCandidates = billQuery
    ? candidateBills.filter(
        (b) =>
          b.name.toLowerCase().includes(billQuery) ||
          (b.category_name ?? "").toLowerCase().includes(billQuery)
      )
    : candidateBills;

  const preview = (projections?.months ?? [])
    .map((m) => ({
      label: m.label,
      amount: m.bills.find((l) => l.kind === "debt" && l.id === -d.id)?.amount,
    }))
    .filter((p): p is { label: string; amount: number } => p.amount != null)
    .slice(0, PLAN_PREVIEW_COUNT);

  if (d.status !== "active") return null;

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--rule)" }}>
      <div className="label muted">{t("paymentPlan.label")}</div>
      <div style={{ marginTop: 4 }}>
        {plan.source === "loan" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{formatMoney(plan.monthly_amount)}/mo</span>{" "}
              <span className="muted">
                {t("paymentPlan.loanFormula", {
                  loanType: LOAN_TYPE_LABEL[plan.loan_type],
                  rate: plan.rate_monthly_percent,
                  term: plan.term_months,
                  sacNote: plan.loan_type === "sac" ? t("paymentPlan.sacNote") : "",
                })}
              </span>
            </div>
            {plan.extra_bills.map((b) => (
              <div key={b.bill_id}>
                <span style={{ fontWeight: 600 }}>{formatMoney(b.amount)}</span>{" "}
                <span className="muted">
                  {t("paymentPlan.extraAmortization", {
                    cadence: cadenceLabel(t, b.cadence),
                    name: b.bill_name,
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
        {plan.source === "combined" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {plan.bills.map((b) => (
              <div key={b.bill_id}>
                <span style={{ fontWeight: 600 }}>{formatMoney(b.amount)}</span>{" "}
                <span className="muted">
                  {t("paymentPlan.fromBill", {
                    cadence: cadenceLabel(t, b.cadence),
                    name: b.bill_name,
                  })}
                </span>
              </div>
            ))}
            {plan.automatic && (
              <div>
                <span style={{ fontWeight: 600 }}>
                  ≈{formatMoney(plan.automatic.monthly_amount)}/mo
                </span>{" "}
                <span className="muted">
                  {t("paymentPlan.automatic", { count: plan.automatic.payment_count })}
                </span>
              </div>
            )}
            <div className="muted" style={{ fontSize: "0.85em" }}>
              {plan.bills.length > 0 && plan.automatic ? t("paymentPlan.combinedPrefix") : ""}
              {t("paymentPlan.boundedBy", { remaining: formatMoney(d.remaining) })}
            </div>
          </div>
        )}
        {plan.source === "none" && (
          <span className="muted">
            {plan.payment_count < 2
              ? t("paymentPlan.noneFewPayments")
              : t("paymentPlan.noneTooVaried")}
            {t("paymentPlan.noneStaysOut", {
              suffix: plan.payment_count < 2 ? t("paymentPlan.noneSuffixAccumulate") : "",
            })}
          </span>
        )}
      </div>

      {preview.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {preview.map((p) => (
            <div
              key={p.label}
              style={{ border: "1px solid var(--rule)", borderRadius: 6, padding: "4px 10px" }}
            >
              <div className="label muted" style={{ fontSize: 11 }}>
                {formatMonthLabel(p.label)}
              </div>
              <div
                className={`money ${p.amount >= 0 ? "gain" : "shortfall"}`}
                style={{ fontSize: 13 }}
              >
                {p.amount >= 0 ? "+" : "-"}
                {formatMoney(Math.abs(p.amount))}
              </div>
            </div>
          ))}
        </div>
      )}
      {preview.length === 0 && plan.source !== "none" && projections && (
        <p className="muted" style={{ fontSize: "0.85em", marginTop: 8, marginBottom: 0 }}>
          {t("paymentPlan.noProjectedPayments", {
            horizon: PLAN_PREVIEW_HORIZON,
            suffix: isFutureDebt(d)
              ? t("paymentPlan.noProjectedSuffix", { date: formatDate(d.start_date) })
              : "",
          })}
        </p>
      )}

      <div style={{ marginTop: 12 }}>
        <div className="label muted" style={{ marginBottom: 6 }}>
          {t("paymentPlan.paidByBills")}
        </div>
        {linkableBills.length === 0 ? (
          <p className="muted" style={{ fontSize: "0.85em", margin: 0 }}>
            {t("paymentPlan.noBillsAvailable")}
          </p>
        ) : (
          <>
            {linkedBills.length === 0 ? (
              <p className="muted" style={{ fontSize: "0.85em", margin: 0 }}>
                {t("paymentPlan.noBillsLinked")}
              </p>
            ) : (
              <div style={{ border: "1px solid var(--rule)", borderRadius: 6 }}>
                {linkedBills.map((b, i) => (
                  <PlanBillRow
                    key={b.id}
                    bill={b}
                    linked
                    first={i === 0}
                    onToggle={(checked) =>
                      updateBill.mutate({ id: b.id, input: { debtId: checked ? d.id : null } })
                    }
                  />
                ))}
              </div>
            )}
            {candidateBills.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setBillPickerOpen((open) => !open)}
                  style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  {billPickerOpen ? <FiChevronDown /> : <FiChevronRight />}
                  {t("paymentPlan.linkAnotherBill", {
                    whichBill:
                      linkedBills.length > 0 ? t("paymentPlan.another") : t("paymentPlan.a"),
                    count: candidateBills.length,
                  })}
                </button>
                {billPickerOpen && (
                  <div style={{ marginTop: 6 }}>
                    {candidateBills.length > 6 && (
                      <input
                        type="text"
                        value={billFilter}
                        onChange={(e) => setBillFilter(e.target.value)}
                        placeholder={t("paymentPlan.filterPlaceholder")}
                        style={{ width: "100%", marginBottom: 6 }}
                      />
                    )}
                    {visibleCandidates.length === 0 ? (
                      <p className="muted" style={{ fontSize: "0.85em", margin: 0 }}>
                        {t("paymentPlan.noBillsMatch", { filter: billFilter.trim() })}
                      </p>
                    ) : (
                      <div
                        style={{
                          border: "1px solid var(--rule)",
                          borderRadius: 6,
                          maxHeight: 220,
                          overflowY: "auto",
                        }}
                      >
                        {visibleCandidates.map((b, i) => (
                          <PlanBillRow
                            key={b.id}
                            bill={b}
                            linked={false}
                            first={i === 0}
                            onToggle={(checked) =>
                              updateBill.mutate({
                                id: b.id,
                                input: { debtId: checked ? d.id : null },
                              })
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {plan.source !== "loan" && (
        <label
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginTop: 10,
          }}
          title={t("paymentPlan.overrideTitle")}
        >
          <input
            type="checkbox"
            checked={d.override_automatic_schedule}
            onChange={(e) =>
              updateDebt.mutate({
                id: d.id,
                input: { overrideAutomaticSchedule: e.target.checked },
              })
            }
          />
          {t("paymentPlan.overrideLabel")}
        </label>
      )}
      <p className="muted" style={{ fontSize: "0.85em", marginTop: 6, marginBottom: 0 }}>
        {plan.source === "loan" ? t("paymentPlan.footerLoan") : t("paymentPlan.footerOther")}
      </p>
    </div>
  );
}

const MAX_CHART_MONTHS = 360; // 30 years of monthly points is plenty for a plot

const chartMonthLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

function compactMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

function moneyTooltip(value: any): string {
  return formatMoney(Number(value));
}

interface BalancePoint {
  date: string;
  balance: number;
  kind: "actual" | "projected";
}

// One debt's month-by-month balance, real history first then projection —
// read straight off the backend's own balance_history/projected_balance_schedule
// (see computeBalanceHistory/computeProjectedBalanceSchedule in
// backend/src/routes/debts.ts) rather than re-simulated here. An earlier
// version of this function reimplemented the PRICE/SAC + extra-bill-capping
// math by hand to draw a *historical* chart, since the backend only exposed
// a future-facing schedule — see backend/API-ARCHITECTURE.md's R1 for why
// that was a maintenance risk (any change to the real projection logic had
// to be mirrored here by hand or the chart would silently disagree with it).
// The only client-side work left is merging two already-authoritative
// series and, for a debt that hasn't started yet, restating its own known
// principal as the anchor point before the schedule's first (already
// post-payment) entry.
function debtBalanceSeries(d: Debt): BalancePoint[] {
  const history: BalancePoint[] = d.balance_history.map((h) => ({
    date: `${h.month}-01`,
    balance: h.balance,
    kind: "actual",
  }));

  const historyMonths = new Set(d.balance_history.map((h) => h.month));
  const projected: BalancePoint[] = d.projected_balance_schedule
    .filter((s) => !historyMonths.has(s.month))
    .map((s) => ({
      date: `${s.month}-01`,
      balance: s.principal_owed + s.interest_owed,
      kind: "projected",
    }));

  // A debt that hasn't started yet has no history at all, and the schedule's
  // first entry is already post-first-payment — without an explicit anchor
  // at the full known principal, the chart would start partway paid down.
  if (history.length === 0 && projected.length > 0) {
    projected.unshift({ date: d.start_date, balance: d.principal, kind: "projected" });
  }

  return [...history, ...projected];
}

interface TrajectoryPoint {
  label: string;
  ifUnpaid: number | null;
  actual: number | null;
  projected: number | null;
  cashBalance: number | null;
}

// Two tiers. With an interest rate, the argument for paying made visible: one
// line is this debt left to compound with nothing ever paid, the other is the
// balance with payments — the widening gap is what paying it down is worth.
// Without a rate there's no hypothetical-growth line to draw, but the real
// balance declining through each repayment (plus the average-payment
// projection) is still the story; with fewer than two payments there's no
// story at all, so a short note stands in for the chart.
function DebtTrajectoryChart(props: { debt: Debt; payOffTx: DebtLinkedTransaction[] }) {
  const { t } = useTranslation("debts");
  const d = props.debt;
  const { payOffTx } = props;
  // Only meaningful for something I owe. projected_balance_schedule's own
  // months are counted from the debt's own anchor (its start_date if that's
  // still in the future, otherwise today) — not from today — so for a
  // future debt, fetching only schedule.length months of the OVERALL
  // projection (which always counts from today) falls short of the debt's
  // own chart, cutting the cash-balance fill off partway through instead of
  // running its full width. Add however many months stand between today and
  // the debt's own start to compensate.
  const today = new Date().toISOString().slice(0, 10);
  const monthsUntilStart = (() => {
    if (d.start_date <= today) return 0;
    const [todayY, todayM] = today.split("-").map(Number);
    const [startY, startM] = d.start_date.split("-").map(Number);
    return (startY - todayY!) * 12 + (startM! - todayM!);
  })();
  const { data: projections } = useProjections(
    Math.max(1, monthsUntilStart + d.projected_balance_schedule.length)
  );

  const chart = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const isFuture = d.start_date > today;
    const rate = d.interest_rate_monthly_percent;
    const hasRate = rate != null && rate > 0 && d.principal > 0;
    const hasSchedule = hasRate && d.loan_type != null && d.target_payoff_date != null;
    // A declared payment bill gives the projection a basis even before any
    // repayment history exists, so it unlocks the chart the same way a loan
    // schedule does.
    const hasPlannedPayment = plannedMonthlyPayment(d) != null;
    if (
      !isFuture &&
      (hasRate
        ? payOffTx.length === 0 && !hasSchedule && !hasPlannedPayment
        : payOffTx.length < 2 && !hasPlannedPayment)
    ) {
      return null;
    }
    if (isFuture && !hasSchedule && !hasPlannedPayment) return null;

    const series = debtBalanceSeries(d);
    if (series.length < 2) return null;

    const r = hasRate ? rate! / 100 : 0;
    const hasProjection = series[series.length - 1].kind === "projected";
    let lastActualIdx = 0;
    series.forEach((p, i) => {
      if (p.kind === "actual") lastActualIdx = i;
    });

    // My own projected cash balance (the overall Projections page forecast,
    // not this debt's trajectory), keyed by the same formatted month label
    // this chart's own points use, so it can be shaded on the SAME chart as
    // a low-opacity fill — how the two overlap is the whole point, and a
    // second chart or axis would only make that harder to see. Only
    // meaningful for something I owe; owed_to_me has no "pay this off with
    // my cash" story.
    const cashBalanceByLabel = new Map<string, number>();
    if (d.direction === "owed_by_me" && projections) {
      // The projection's own months always start at *next* calendar month —
      // it never includes the current, still-in-progress one — but this
      // chart's own first projected point usually falls in the current
      // month (right after wherever real history stops). Without this, that
      // one point has no match, so the fill starts one point late — right
      // where a nearby "You can pay off here" line would otherwise land,
      // making the whole thing look like it's cut off before reaching it.
      // startingBalance is exactly that missing point: today's real balance,
      // before any of the projected months' flows are applied.
      cashBalanceByLabel.set(chartMonthLabel.format(new Date(today)), projections.startingBalance);
      for (const m of projections.months) {
        cashBalanceByLabel.set(chartMonthLabel.format(new Date(m.label + "-01")), m.balance);
      }
    }

    // Series points are exactly one month apart from start_date, so the index
    // doubles as "months elapsed" for the compounding line.
    const points: TrajectoryPoint[] = series.map((p, i) => {
      const label = chartMonthLabel.format(new Date(p.date));
      return {
        label,
        ifUnpaid: hasRate ? d.principal * (1 + r) ** i : null,
        actual: p.kind === "actual" ? p.balance : null,
        projected:
          p.kind === "projected" || (hasProjection && i === lastActualIdx) ? p.balance : null,
        cashBalance: cashBalanceByLabel.get(label) ?? null,
      };
    });

    // Hypothetical minus actual minus everything paid in = the compounding
    // dodged purely by keeping the balance low — not just the money put in.
    // actualNow/totalPaid read straight off the debt's own server-computed
    // fields (d.remaining is exactly currentPayoffBalance for a rate-bearing
    // debt) rather than re-running simulateAmortization here; only
    // ifUnpaidNow is a genuine "what if" with no backend equivalent to read.
    let avoided: { amount: number; ifUnpaidNow: number; actualNow: number } | null = null;
    if (hasRate && payOffTx.length > 0 && d.direction === "owed_by_me") {
      const monthsNow = Math.max(
        0,
        (Date.parse(today) - Date.parse(d.start_date)) / (1000 * 60 * 60 * 24) / 30.44
      );
      const ifUnpaidNow = d.principal * (1 + r) ** monthsNow;
      const actualNow = Math.max(0, d.remaining);
      const amount = ifUnpaidNow - actualNow - d.total_paid;
      if (amount > 0.5) avoided = { amount, ifUnpaidNow, actualNow };
    }

    // The earliest month projected cash balance (the same overall
    // Projections page forecast, not this debt's own trajectory) is enough,
    // on its own, to wipe out everything still owed on this debt right then
    // — principal plus interest still left to accrue, from
    // projected_balance_schedule. Only meaningful for something I owe
    // (paying off a debt someone owes ME isn't a thing).
    let canPayOffMonth: string | null = null;
    let canPayOffLabel: string | null = null;
    if (d.direction === "owed_by_me" && projections) {
      const owedByMonth = new Map(
        d.projected_balance_schedule.map((s) => [s.month, s.principal_owed + s.interest_owed])
      );
      const hit = projections.months.find((m) => {
        const owed = owedByMonth.get(m.label);
        return owed != null && m.balance >= owed;
      });
      if (hit) {
        const label = chartMonthLabel.format(new Date(hit.label + "-01"));
        // Only drawn/stated if that month is actually plotted here.
        if (points.some((p) => p.label === label)) {
          canPayOffMonth = hit.label;
          canPayOffLabel = label;
        }
      }
    }

    return {
      points,
      avoided,
      hasRate,
      rate: hasRate ? rate! : null,
      hasProjection,
      isFuture,
      // For a future debt every point is projected — there's no "today" split
      // inside the chart to mark, since the whole thing hasn't happened yet.
      todayLabel: hasProjection && !isFuture ? points[lastActualIdx].label : null,
      canPayOffLabel,
      canPayOffMonth,
      projectionSource: hasSchedule
        ? ("schedule" as const)
        : hasPlannedPayment
          ? ("bill" as const)
          : ("heuristic" as const),
      // Straight off the debt's own server-computed fields (see
      // computeProjectedFinishDate in backend/src/routes/debts.ts) rather
      // than re-simulated here — the one thing this chart must never do is
      // disagree with what the real projection converges on.
      lifetimeTotals:
        hasRate && d.projected_remaining_interest != null
          ? {
              totalInterest: (d.interest_paid_so_far ?? 0) + d.projected_remaining_interest,
              totalPaid:
                d.principal + (d.interest_paid_so_far ?? 0) + d.projected_remaining_interest,
              reachesPayoff: d.projected_finish_date != null,
            }
          : null,
    };
  }, [d, payOffTx, projections]);

  if (!chart) {
    if (d.status !== "active" || isFutureDebt(d)) return null;
    return (
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--rule)" }}>
        <p className="muted" style={{ fontSize: "0.85em", margin: 0 }}>
          {t("trajectoryChart.notEnoughHistory")}
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--rule)" }}>
      <div className="label muted">
        {chart.isFuture
          ? t("trajectoryChart.titleFuture")
          : chart.hasRate
            ? t("trajectoryChart.titleWithRate")
            : t("trajectoryChart.titlePlain")}
      </div>
      {chart.avoided && (
        <div style={{ marginTop: 4 }}>
          <span style={{ fontWeight: 600 }}>{formatMoney(chart.avoided.amount)}</span>{" "}
          <span className="muted">
            {t("trajectoryChart.avoided", {
              ifUnpaid: formatMoney(chart.avoided.ifUnpaidNow),
              actual: formatMoney(chart.avoided.actualNow),
            })}
          </span>
        </div>
      )}
      <div className="chart-container" style={{ height: 240, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chart.points}>
            <XAxis dataKey="label" stroke="var(--text-muted)" minTickGap={24} />
            <YAxis stroke="var(--text-muted)" tickFormatter={compactMoney} />
            <Tooltip formatter={moneyTooltip} />
            {(chart.hasRate || chart.hasProjection) && <Legend />}
            {/* My projected cash balance as a low-opacity fill, not a line —
                declared first so it renders behind the debt's own balance
                lines (recharts stacks children in declaration order). The
                point is seeing where it overlaps the debt still owed, not
                adding another line competing for attention. A distinct blue
                (not --accent green, already this debt's own balance color,
                or --danger/--gold, already "if never paid"/"can pay off"
                here) so the fill can't be mistaken for the debt's own line. */}
            <Area
              type="monotone"
              dataKey="cashBalance"
              name={t("trajectoryChart.legendCashBalance")}
              stroke="none"
              fill="#5f7fbf"
              fillOpacity={0.18}
            />
            {chart.todayLabel && <ReferenceLine x={chart.todayLabel} stroke="var(--rule)" />}
            {chart.canPayOffLabel && (
              <ReferenceLine
                x={chart.canPayOffLabel}
                stroke="var(--gold)"
                strokeDasharray="4 4"
                label={{
                  value: t("trajectoryChart.canPayOffHere"),
                  position: "insideTopRight",
                  fill: "var(--gold)",
                  fontSize: 11,
                }}
              />
            )}
            {chart.hasRate && (
              <Line
                type="monotone"
                dataKey="ifUnpaid"
                name={t("trajectoryChart.legendIfNeverPaid")}
                stroke="var(--danger)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
              />
            )}
            <Line
              type="monotone"
              dataKey="actual"
              name={t("trajectoryChart.legendBalanceReal")}
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
            />
            {chart.hasProjection && (
              <Line
                type="monotone"
                dataKey="projected"
                name={t("trajectoryChart.legendBalanceProjected")}
                stroke="var(--accent)"
                strokeWidth={2}
                strokeDasharray="5 4"
                strokeOpacity={0.7}
                dot={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {chart.canPayOffMonth && (
        <p className="muted" style={{ fontSize: "0.85em", marginTop: 6, marginBottom: 0 }}>
          {t("trajectoryChart.canPayOffNote", { month: formatMonthLabel(chart.canPayOffMonth) })}
        </p>
      )}
      <p className="muted" style={{ fontSize: "0.85em", marginTop: 6, marginBottom: 0 }}>
        {chart.isFuture
          ? t("trajectoryChart.captionFuture", {
              source:
                chart.projectionSource === "schedule"
                  ? t("trajectoryChart.captionFutureSourceSchedule")
                  : chart.projectionSource === "bill"
                    ? t("trajectoryChart.captionFutureSourceBill")
                    : t("trajectoryChart.captionFutureSourcePlanned"),
            })
          : chart.hasRate
            ? t("trajectoryChart.captionWithRate", {
                rate: chart.rate,
                source: chart.hasProjection
                  ? chart.projectionSource === "schedule"
                    ? t("trajectoryChart.captionWithRateSourceSchedule")
                    : chart.projectionSource === "bill"
                      ? t("trajectoryChart.captionWithRateSourceBill")
                      : t("trajectoryChart.captionWithRateSourceHeuristic")
                  : "",
              })
            : t("trajectoryChart.captionPlain", {
                source: chart.hasProjection
                  ? chart.projectionSource === "bill"
                    ? t("trajectoryChart.captionPlainSourceBill")
                    : t("trajectoryChart.captionPlainSourceHeuristic")
                  : "",
              })}
      </p>
      {chart.lifetimeTotals && (
        <div
          style={{
            display: "flex",
            gap: 24,
            flexWrap: "wrap",
            marginTop: 10,
            paddingTop: 10,
            borderTop: "1px solid var(--rule)",
          }}
        >
          <div>
            <div className="label muted" style={{ fontSize: 11 }}>
              {chart.lifetimeTotals.reachesPayoff
                ? t("trajectoryChart.totalInterestLifetime")
                : t("trajectoryChart.totalInterestRunning")}
            </div>
            <div style={{ fontWeight: 600 }}>{formatMoney(chart.lifetimeTotals.totalInterest)}</div>
          </div>
          <div>
            <div className="label muted" style={{ fontSize: 11 }}>
              {chart.lifetimeTotals.reachesPayoff
                ? t("trajectoryChart.totalPaidLifetime")
                : t("trajectoryChart.totalPaidRunning")}
            </div>
            <div style={{ fontWeight: 600 }}>{formatMoney(chart.lifetimeTotals.totalPaid)}</div>
          </div>
          {!chart.lifetimeTotals.reachesPayoff && (
            <p className="muted" style={{ fontSize: "0.8em", margin: 0, flexBasis: "100%" }}>
              {t("trajectoryChart.notTrueEndOfLoan")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface OverviewPoint {
  label: string;
  owedActual: number | null;
  owedProjected: number | null;
  lentActual: number | null;
  lentProjected: number | null;
}

// The whole ledger at a glance: every debt's own trajectory (the same series
// the per-debt chart draws) summed by direction. Owed-to-me stays its own
// line rather than netting against what I owe — money someone owes me doesn't
// pay my debts until it actually arrives. Same-direction linked child debts
// are skipped (see the childIds comment below for why only same-direction
// links double-count); future debts haven't started.
function DebtOverviewChart(props: { debts: Debt[] }) {
  const { t } = useTranslation("debts");
  const today = new Date().toISOString().slice(0, 10);
  // Only a same-direction link double-counts a child's principal into its
  // parent's total (e.g. two "owed_by_me" debts where one folds into the
  // other). A cross-direction link — Foz (owed_by_me, a real debt to the
  // architect) feeding into Juliana's unrelated owed_to_me receivable — is
  // two separate obligations that both belong in their own bucket; only
  // the parent's own direction is what's actually inflated by the link.
  const childIds = new Set(
    props.debts.flatMap((d) =>
      d.linked_debts
        .filter((ld) => props.debts.find((other) => other.id === ld.id)?.direction === d.direction)
        .map((ld) => ld.id)
    )
  );
  const relevant = props.debts.filter((d) => !childIds.has(d.id) && d.start_date <= today);

  // Each debt already carries its own balance_history/projected_balance_schedule
  // (see debtBalanceSeries) — no per-debt transaction fetch needed here
  // anymore now that the backend owns the balance computation.
  const chart = useMemo(() => {
    const seriesByDebt = relevant
      .map((d) => ({ debt: d, series: debtBalanceSeries(d) }))
      .filter((s) => s.series.length > 0);
    if (seriesByDebt.length === 0) return null;

    const gridStart = seriesByDebt.reduce(
      (min, s) => (s.series[0].date < min ? s.series[0].date : min),
      today
    );
    const gridEnd = seriesByDebt.reduce((max, s) => {
      const last = s.series[s.series.length - 1].date;
      return last > max ? last : max;
    }, today);
    let months = 0;
    while (months < MAX_CHART_MONTHS && addMonthsIso(gridStart, months + 1) <= gridEnd) months++;
    const gridDates: string[] = [];
    for (let m = 0; m <= months; m++) gridDates.push(addMonthsIso(gridStart, m));
    if (gridDates.length < 2) return null;

    let lastActualIdx = 0;
    gridDates.forEach((g, i) => {
      if (g <= today) lastActualIdx = i;
    });
    const hasProjection = lastActualIdx < gridDates.length - 1;

    // Step-hold sampling: each debt contributes its most recent balance at or
    // before the grid date — 0 before it starts, and its last known balance
    // held flat past the end of its series (a paid-off debt holds at 0, an
    // active one with no basis to project holds where it is).
    const sumAt = (g: string, dir: Debt["direction"]): number => {
      let sum = 0;
      for (const { debt, series } of seriesByDebt) {
        if (debt.direction !== dir || g < series[0].date) continue;
        let balance = series[0].balance;
        for (const p of series) {
          if (p.date <= g) balance = p.balance;
          else break;
        }
        sum += balance;
      }
      return sum;
    };

    const hasOwed = seriesByDebt.some((s) => s.debt.direction === "owed_by_me");
    const hasLent = seriesByDebt.some((s) => s.debt.direction === "owed_to_me");

    const points: OverviewPoint[] = gridDates.map((g, i) => {
      const owed = hasOwed ? sumAt(g, "owed_by_me") : null;
      const lent = hasLent ? sumAt(g, "owed_to_me") : null;
      const isActual = i <= lastActualIdx;
      const isProjected = hasProjection && i >= lastActualIdx;
      return {
        label: chartMonthLabel.format(new Date(g)),
        owedActual: isActual ? owed : null,
        owedProjected: isProjected ? owed : null,
        lentActual: isActual ? lent : null,
        lentProjected: isProjected ? lent : null,
      };
    });

    return {
      points,
      hasOwed,
      hasLent,
      hasProjection,
      todayLabel: hasProjection ? points[lastActualIdx].label : null,
    };
  }, [relevant, today]);

  if (!chart) return null;

  return (
    <div className="card">
      <h2 style={{ margin: 0 }}>{t("overviewChart.title")}</h2>
      <div className="chart-container" style={{ height: 240, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart.points}>
            <XAxis dataKey="label" stroke="var(--text-muted)" minTickGap={24} />
            <YAxis stroke="var(--text-muted)" tickFormatter={compactMoney} />
            <Tooltip formatter={moneyTooltip} />
            {((chart.hasOwed && chart.hasLent) || chart.hasProjection) && <Legend />}
            {chart.todayLabel && <ReferenceLine x={chart.todayLabel} stroke="var(--rule)" />}
            {chart.hasOwed && (
              <Line
                type="monotone"
                dataKey="owedActual"
                name={t("overviewChart.legendOwedReal")}
                stroke="var(--danger)"
                strokeWidth={2}
                dot={false}
              />
            )}
            {chart.hasOwed && chart.hasProjection && (
              <Line
                type="monotone"
                dataKey="owedProjected"
                name={t("overviewChart.legendOwedProjected")}
                stroke="var(--danger)"
                strokeWidth={2}
                strokeDasharray="5 4"
                strokeOpacity={0.7}
                dot={false}
              />
            )}
            {chart.hasLent && (
              <Line
                type="monotone"
                dataKey="lentActual"
                name={t("overviewChart.legendLentReal")}
                stroke="var(--accent)"
                strokeWidth={2}
                dot={false}
              />
            )}
            {chart.hasLent && chart.hasProjection && (
              <Line
                type="monotone"
                dataKey="lentProjected"
                name={t("overviewChart.legendLentProjected")}
                stroke="var(--accent)"
                strokeWidth={2}
                strokeDasharray="5 4"
                strokeOpacity={0.7}
                dot={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="muted" style={{ fontSize: "0.85em", marginTop: 6, marginBottom: 0 }}>
        {t("overviewChart.caption")}
      </p>
    </div>
  );
}

function DebtBalanceScheduleTooltip(props: {
  active?: boolean;
  label?: string;
  payload?: { payload?: { principal_owed: number; interest_owed: number } }[];
}) {
  const { t } = useTranslation("debts");
  const point = props.payload?.[0]?.payload;
  if (!props.active || point == null) return null;
  const total = point.principal_owed + point.interest_owed;
  return (
    <div className="recharts-default-tooltip" style={{ padding: "8px 12px", borderRadius: 4 }}>
      <p className="recharts-tooltip-label" style={{ margin: "0 0 4px" }}>
        {props.label}
      </p>
      <p className="recharts-tooltip-item" style={{ margin: 0, color: "var(--danger)" }}>
        {t("balanceScheduleTooltip.principalOwed", { amount: formatMoney(point.principal_owed) })}
      </p>
      {point.interest_owed > 0 && (
        <p className="recharts-tooltip-item" style={{ margin: 0, color: "var(--gold)" }}>
          {t("balanceScheduleTooltip.interestOwed", { amount: formatMoney(point.interest_owed) })}
        </p>
      )}
      <p className="recharts-tooltip-item" style={{ margin: "4px 0 0", fontWeight: 600 }}>
        {t("balanceScheduleTooltip.totalOwed", { amount: formatMoney(total) })}
      </p>
    </div>
  );
}

// What's still owed on this one debt, month by month — remaining principal
// plus interest still left to accrue before payoff, both reaching zero
// together right at the same projected_finish_date the trajectory chart
// above marks. Straight off the server-computed schedule (see
// computeProjectedBalanceSchedule in backend/src/routes/debts.ts), not
// re-simulated here, so it can never disagree with that date.
function DebtBalanceScheduleChart(props: { debt: Debt }) {
  const { t } = useTranslation("debts");
  const d = props.debt;
  if (d.projected_balance_schedule.length === 0) return null;
  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--rule)" }}>
      <div className="label muted" style={{ marginBottom: 6 }}>
        {t("balanceScheduleChart.title")}
      </div>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={d.projected_balance_schedule}>
            <XAxis dataKey="month" stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--text-muted)" tickFormatter={compactMoney} />
            <Tooltip content={<DebtBalanceScheduleTooltip />} />
            <Bar
              dataKey="principal_owed"
              name={t("balanceScheduleChart.legendPrincipal")}
              stackId="owed"
              fill="var(--danger)"
            />
            <Bar
              dataKey="interest_owed"
              name={t("balanceScheduleChart.legendInterest")}
              stackId="owed"
              fill="var(--gold)"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="muted" style={{ fontSize: "0.85em", marginTop: 6, marginBottom: 0 }}>
        {t("balanceScheduleChart.caption")}
      </p>
    </div>
  );
}

function DebtCard(props: { debt: Debt; allDebts: Debt[] }) {
  const { t } = useTranslation(["debts", "common"]);
  const [expanded, setExpanded] = useState(false);
  // Loaded unconditionally (not just when expanded) so the interest rate
  // editor can compute a live preview as you type.
  const { data: linkedTx } = useDebtTransactions(props.debt.id);
  const payOffTx = useMemo(
    () => (linkedTx ?? []).filter((tx) => tx.role === "pay_off"),
    [linkedTx]
  );
  const showInterestColumn = payOffTx.some((tx) => tx.interest != null && tx.interest > 0.005);
  const finishDate = props.debt.projected_finish_date;
  const {
    sorted: sortedLinkedTx,
    sortKey: linkedSortKey,
    direction: linkedSortDirection,
    toggleSort: toggleLinkedSort,
  } = useSortableTable<DebtLinkedTransaction>(
    linkedTx ?? [],
    (tx, key) => {
      switch (key) {
        case "description":
          return tx.description;
        case "amount":
          return tx.amount;
        case "interest":
          return tx.interest ?? 0;
        case "role":
          return tx.role;
        default:
          return tx.date;
      }
    },
    "date",
    "desc"
  );
  const unlink = useUnlinkTransactionsFromDebt();
  const updateDebt = useUpdateDebt();
  const deleteDebt = useDeleteDebt();

  const d = props.debt;
  const tone = d.direction === "owed_by_me" ? "negative" : "positive";
  const directionLabel =
    d.direction === "owed_by_me" ? t("direction.owe") : t("direction.owedToMe");

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>
          {d.name}
          {d.counterparty && <span className="muted"> — {d.counterparty}</span>}
        </h3>
        <span
          style={{
            color: tone === "negative" ? "var(--danger)" : "var(--accent)",
            fontWeight: 600,
          }}
        >
          {directionLabel}
        </span>
      </div>

      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 16,
          marginTop: 12,
        }}
      >
        <StartDateEditor debt={d} />
        <PrincipalEditor debt={d} />
        <div>
          <div className="label muted">{t("card.paidSoFar")}</div>
          <div className="money">{formatMoney(d.total_paid)}</div>
        </div>
        {!isFutureDebt(d) && (
          <div>
            <div className="label muted">{t("card.remaining")}</div>
            <div className="money">{formatMoney(d.remaining)}</div>
            {d.remaining_interest != null && (
              <div className="muted" style={{ fontSize: "0.85em" }}>
                {t("card.ofWhichInterest", { amount: formatMoney(d.remaining_interest) })}
              </div>
            )}
          </div>
        )}
        {d.interest_paid_so_far != null && (
          <div>
            <div className="label muted">{t("card.interestPaid")}</div>
            <div className="money">{formatMoney(d.interest_paid_so_far)}</div>
          </div>
        )}
        {d.split_percentage != null && (
          <div>
            <div className="label muted">{t("card.split")}</div>
            <div className="money">{d.split_percentage}%</div>
          </div>
        )}
        {finishDate && (
          <div>
            <div className="label muted">{t("card.finishDate")}</div>
            <div className="money">{formatDate(finishDate)}</div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <ProgressBar percent={d.percent_complete} tone={tone} />
      </div>

      <PaymentPlanSection debt={d} />

      <PayoffProjection debt={d} />

      <DebtTrajectoryChart debt={d} payOffTx={payOffTx} />

      <DebtBalanceScheduleChart debt={d} />

      <div
        style={{
          marginTop: 16,
          paddingTop: 12,
          borderTop: "1px solid var(--rule)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <InterestRateEditor debt={d} payOffTx={payOffTx} />
        <LoanTypeEditor debt={d} />
      </div>

      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: "1px solid var(--rule)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <MatchingRuleEditor debt={d} />
        <LinkedDebtsEditor debt={d} allDebts={props.allDebts} />
        <button
          className="link-button"
          onClick={() => setExpanded((e) => !e)}
          style={{ alignSelf: "start" }}
        >
          {expanded ? <FiChevronDown /> : <FiChevronRight />}{" "}
          {t("card.linkedTransactions", { count: d.transaction_count })}
        </button>
      </div>

      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: "1px solid var(--rule)",
          display: "flex",
          gap: 16,
          alignItems: "center",
        }}
      >
        {d.status === "active" ? (
          <button
            className="secondary"
            onClick={() => updateDebt.mutate({ id: d.id, input: { status: "paid_off" } })}
          >
            {t("card.markPaidOff")}
          </button>
        ) : (
          <span className="muted">{t("card.paidOff")}</span>
        )}
        <button
          className="danger icon"
          style={{ marginLeft: "auto" }}
          onClick={() => deleteDebt.mutate(d.id)}
          title={t("card.deleteTitle")}
        >
          <FiTrash2 />
        </button>
      </div>

      {expanded && (
        <>
          {linkedTx && linkedTx.length > 0 && (
            <table style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <SortableTh
                    label={t("common:table.date")}
                    sortKey="date"
                    activeKey={linkedSortKey}
                    direction={linkedSortDirection}
                    onSort={toggleLinkedSort}
                  />
                  <SortableTh
                    label={t("common:table.description")}
                    sortKey="description"
                    activeKey={linkedSortKey}
                    direction={linkedSortDirection}
                    onSort={toggleLinkedSort}
                  />
                  <SortableTh
                    label={t("common:table.amount")}
                    sortKey="amount"
                    activeKey={linkedSortKey}
                    direction={linkedSortDirection}
                    onSort={toggleLinkedSort}
                  />
                  {showInterestColumn && (
                    <SortableTh
                      label={t("card.interestColumn")}
                      sortKey="interest"
                      activeKey={linkedSortKey}
                      direction={linkedSortDirection}
                      onSort={toggleLinkedSort}
                    />
                  )}
                  <SortableTh
                    label={t("card.roleColumn")}
                    sortKey="role"
                    activeKey={linkedSortKey}
                    direction={linkedSortDirection}
                    onSort={toggleLinkedSort}
                  />
                  <th />
                </tr>
              </thead>
              <tbody>
                {sortedLinkedTx.map((tx) => (
                  <tr key={tx.id}>
                    <td>{formatDate(tx.date)}</td>
                    <td>{tx.description}</td>
                    <td className="money">{formatMoney(tx.amount, tx.currency_code)}</td>
                    {showInterestColumn && (
                      <td className="money">
                        {tx.interest != null && tx.interest > 0.005
                          ? formatMoney(tx.interest)
                          : "—"}
                      </td>
                    )}
                    <td>{t(`roleShort.${tx.role}`)}</td>
                    <td>
                      <button
                        className="link-button"
                        onClick={() => unlink.mutate({ debtId: d.id, transactionIds: [tx.id] })}
                        title={t("card.unlinkTitle")}
                      >
                        <MdLinkOff />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <DebtLinker
            debtId={d.id}
            startDate={d.start_date}
            linkedIds={new Set((linkedTx ?? []).map((tx) => tx.id))}
          />
        </>
      )}
    </div>
  );
}

export function DebtsPage() {
  const { t } = useTranslation("debts");
  const { data: debts } = useDebts();
  const createDebt = useCreateDebt();

  const [name, setName] = useState("");
  const [direction, setDirection] = useState<(typeof DIRECTION_VALUES)[number]>("owed_by_me");
  const [counterparty, setCounterparty] = useState("");
  const [mode, setMode] = useState<"fixed" | "split">("fixed");
  const [principalAmount, setPrincipalAmount] = useState("");
  const [splitPercentage, setSplitPercentage] = useState("");
  const [expectedTotalAmount, setExpectedTotalAmount] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [targetPayoffDate, setTargetPayoffDate] = useState("");
  const [loanType, setLoanType] = useState<(typeof LOAN_TYPE_VALUES)[number]>("");
  const [matchingRule, setMatchingRule] = useState("");

  const active = (debts ?? []).filter((d) => d.status === "active" && !isFutureDebt(d));
  const future = (debts ?? []).filter((d) => isFutureDebt(d));
  const paidOff = (debts ?? []).filter((d) => d.status === "paid_off");
  const [addOpen, setAddOpen] = useState(false);
  const [selectedDebtId, setSelectedDebtId] = useState<number | null>(null);
  const selectedDebt = (debts ?? []).find((d) => d.id === selectedDebtId);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name) return;
    if (mode === "fixed" && !principalAmount) return;
    if (mode === "split" && !splitPercentage) return;
    createDebt.mutate(
      {
        name,
        direction,
        counterparty: counterparty || undefined,
        principalAmount: mode === "fixed" ? Number(principalAmount) : undefined,
        splitPercentage: mode === "split" ? Number(splitPercentage) : undefined,
        expectedTotalAmount: expectedTotalAmount ? Number(expectedTotalAmount) : undefined,
        startDate,
        targetPayoffDate: targetPayoffDate || undefined,
        loanType: loanType || undefined,
        matchingRule: matchingRule || undefined,
      },
      {
        onSuccess: () => {
          setName("");
          setCounterparty("");
          setPrincipalAmount("");
          setSplitPercentage("");
          setExpectedTotalAmount("");
          setTargetPayoffDate("");
          setLoanType("");
          setMatchingRule("");
        },
      }
    );
  }

  if (selectedDebt) {
    return (
      <div className="grid" style={{ gap: 16 }}>
        <button
          className="secondary"
          onClick={() => setSelectedDebtId(null)}
          style={{ alignSelf: "start" }}
        >
          <FiArrowLeft /> {t("page.backToAll")}
        </button>
        <DebtCard debt={selectedDebt} allDebts={debts ?? []} />
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 24 }}>
      <DebtOverviewChart debts={debts ?? []} />

      {active.length > 0 && (
        <div className="grid" style={{ gap: 16 }}>
          <h2>{t("page.active")}</h2>
          <div
            className="grid"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}
          >
            {active.map((d) => (
              <DebtTile key={d.id} debt={d} onSelect={() => setSelectedDebtId(d.id)} />
            ))}
          </div>
        </div>
      )}

      {future.length > 0 && (
        <div className="grid" style={{ gap: 16 }}>
          <h2>{t("page.future")}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {t("page.futureNote")}
          </p>
          <div
            className="grid"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}
          >
            {future.map((d) => (
              <DebtTile key={d.id} debt={d} onSelect={() => setSelectedDebtId(d.id)} />
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <button className="disclosure" onClick={() => setAddOpen((o) => !o)}>
          {addOpen ? <FiChevronDown /> : <FiChevronRight />} {t("page.addDebt")}
        </button>
        {addOpen && (
          <div style={{ marginTop: 12 }}>
            <p className="muted">{t("page.addDebtDescription")}</p>
            <form
              onSubmit={submit}
              className="grid"
              style={{ gridTemplateColumns: "repeat(4, auto)", alignItems: "end", gap: 16 }}
            >
              <label>
                {t("page.name")}
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <label>
                {t("page.direction")}
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as typeof direction)}
                >
                  {directionOptions(t).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("page.counterparty")}
                <input
                  type="text"
                  value={counterparty}
                  onChange={(e) => setCounterparty(e.target.value)}
                />
              </label>
              <label>
                {t("page.principalMode")}
                <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                  <option value="fixed">{t("page.modeFixed")}</option>
                  <option value="split">{t("page.modeSplit")}</option>
                </select>
              </label>
              {mode === "fixed" ? (
                <label>
                  {t("page.principalAmount")}
                  <input
                    type="number"
                    step="0.01"
                    value={principalAmount}
                    onChange={(e) => setPrincipalAmount(e.target.value)}
                  />
                </label>
              ) : (
                <label>
                  {t("page.splitPercentage")}
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max="100"
                    value={splitPercentage}
                    onChange={(e) => setSplitPercentage(e.target.value)}
                  />
                </label>
              )}
              <label>
                {t("page.expectedTotal")}
                <input
                  type="number"
                  step="0.01"
                  placeholder={t("page.optional")}
                  value={expectedTotalAmount}
                  onChange={(e) => setExpectedTotalAmount(e.target.value)}
                />
              </label>
              <label>
                {t("page.startDate")}
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </label>
              <label>
                {t("page.targetPayoffDate")}
                <input
                  type="date"
                  value={targetPayoffDate}
                  onChange={(e) => setTargetPayoffDate(e.target.value)}
                />
              </label>
              <label>
                {t("page.loanType")}
                <select
                  value={loanType}
                  onChange={(e) => setLoanType(e.target.value as typeof loanType)}
                >
                  {loanTypeOptions(t).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit">
                <FiPlus /> {t("page.submit")}
              </button>
            </form>
            <label style={{ display: "block", marginTop: 16 }}>
              {t("page.matchingRuleLabel")}
              <textarea
                value={matchingRule}
                onChange={(e) => setMatchingRule(e.target.value)}
                placeholder={t("matchingRule.placeholder")}
                rows={2}
                style={{ width: "100%", resize: "vertical" }}
              />
            </label>
          </div>
        )}
      </div>

      {paidOff.length > 0 && (
        <div className="grid" style={{ gap: 16 }}>
          <h2>{t("page.paidOffHeading")}</h2>
          <div
            className="grid"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}
          >
            {paidOff.map((d) => (
              <DebtTile key={d.id} debt={d} onSelect={() => setSelectedDebtId(d.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
