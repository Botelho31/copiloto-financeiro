import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { FiArrowLeft, FiChevronDown, FiChevronRight, FiLink, FiPlus, FiTrash2 } from "react-icons/fi";
import { MdLinkOff } from "react-icons/md";
import {
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
import {
  addMonthsIso,
  billAppliesToMonth,
  localMonthDate,
  monthlyEquivalentAmount,
  pricePayment,
  simulateAmortization,
} from "shared";
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
import { apiFetch } from "../lib/api";
import { useSortableTable } from "../hooks/useSortableTable";
import { SortableTh } from "../components/SortableTh";
import { formatDate, formatMoney, formatMonthLabel } from "../lib/format";

const DIRECTIONS = [
  { value: "owed_by_me", label: "I borrowed (I owe)" },
  { value: "owed_to_me", label: "I lent (owed to me)" },
] as const;

const LOAN_TYPES = [
  { value: "", label: "None (not a formal loan)" },
  { value: "price", label: "PRICE (constant payment)" },
  { value: "sac", label: "SAC (constant amortization)" },
] as const;

const LOAN_TYPE_LABEL: Record<"price" | "sac", string> = { price: "PRICE", sac: "SAC" };

function isFutureDebt(d: Debt): boolean {
  return d.status === "active" && d.start_date > new Date().toISOString().slice(0, 10);
}

const ROLES = [
  { value: "borrow", label: "Borrow (I received this)" },
  { value: "lend", label: "Lend (I gave this)" },
  { value: "pay_off", label: "Pay off (a repayment)" },
] as const;

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
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]["value"]>("pay_off");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data: rawResults, isFetching } = useSearchTransactions(debouncedQuery);
  const filteredResults = (rawResults ?? []).filter(
    (t) => t.date >= props.startDate && !props.linkedIds.has(t.id)
  );
  const { sorted: results, sortKey, direction, toggleSort } = useSortableTable(
    filteredResults,
    (t, key) => (key === "date" ? t.date : key === "description" ? t.description : t.amount),
    "date",
    "desc"
  );
  const link = useLinkTransactionsToDebt();

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search transactions to link…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <select value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number]["value"])}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      {debouncedQuery.trim() &&
        (isFetching ? (
          <p className="muted">Searching…</p>
        ) : results.length === 0 ? (
          <p className="muted">No matching transactions (already linked, or before this debt started).</p>
        ) : (
          <table>
            <thead>
              <tr>
                <SortableTh label="Date" sortKey="date" activeKey={sortKey} direction={direction} onSort={toggleSort} />
                <SortableTh label="Description" sortKey="description" activeKey={sortKey} direction={direction} onSort={toggleSort} />
                <SortableTh label="Amount" sortKey="amount" activeKey={sortKey} direction={direction} onSort={toggleSort} />
                <th />
              </tr>
            </thead>
            <tbody>
              {results.map((t) => (
                <tr key={t.id}>
                  <td>{formatDate(t.date)}</td>
                  <td>{t.description}</td>
                  <td className="money">{formatMoney(t.amount, t.currency_code)}</td>
                  <td>
                    <button
                      className="link-button"
                      onClick={() => link.mutate({ debtId: props.debtId, transactionIds: [t.id], role })}
                      title="Link"
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
      props.payOffTx.map((t) => ({ id: t.id, date: t.date, amount: Math.abs(t.amount) }))
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
      <div className="label muted">Interest rate (per month)</div>
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
        <span className="muted">% a.m.</span>
        {annualRate != null && (
          <span className="muted" style={{ fontSize: "0.85em" }}>
            ({annualRate.toFixed(2)}% a.a.)
          </span>
        )}
      </div>
      {isDirty && preview && (
        <div className="muted" style={{ fontSize: "0.85em", marginTop: 4 }}>
          → remaining {formatMoney(preview.currentPayoffBalance)} ({formatMoney(preview.interestAccruedSinceLastPayment)}{" "}
          interest), {formatMoney(preview.totalInterestPaid)} interest paid so far
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
  const updateDebt = useUpdateDebt();

  function save(value: string) {
    updateDebt.mutate({
      id: props.debt.id,
      input: { loanType: value === "" ? null : (value as "price" | "sac") },
    });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div className="label muted">Loan type</div>
      <select value={props.debt.loan_type ?? ""} onChange={(e) => save(e.target.value)}>
        {LOAN_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function StartDateEditor(props: { debt: Debt }) {
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
      <div className="label muted">Start date</div>
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        className="money"
      />
      {isFutureDebt(props.debt) && <span className="muted" style={{ fontSize: 12 }}> (future)</span>}
    </div>
  );
}

// Editable only for a fixed-amount debt — a split-percentage debt's
// principal is derived from linked transactions/other debts, not a value of
// its own to type in.
function PrincipalEditor(props: { debt: Debt }) {
  const updateDebt = useUpdateDebt();
  const d = props.debt;
  const [value, setValue] = useState(String(d.principal_amount ?? ""));

  useEffect(() => {
    setValue(String(d.principal_amount ?? ""));
  }, [d.principal_amount]);

  if (d.split_percentage != null) {
    return (
      <div>
        <div className="label muted">Principal</div>
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
      <div className="label muted">Principal</div>
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
      <button className="link-button" onClick={() => setOpen((o) => !o)} style={{ alignSelf: "start" }}>
        {open ? <FiChevronDown /> : <FiChevronRight />} Matching rule
        {props.debt.matching_rule ? "" : " (not set)"}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div className="label muted">Matching rule</div>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={save}
            placeholder="Exactly how to classify future transactions against this debt — e.g. counterparty pattern, amount threshold, role. This is what I'll follow when you ask me to update this debt."
            rows={2}
            style={{ width: "100%", resize: "vertical" }}
          />
        </div>
      )}
    </div>
  );
}

function LinkedDebtsEditor(props: { debt: Debt; allDebts: Debt[] }) {
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
      <button className="link-button" onClick={() => setOpen((o) => !o)} style={{ alignSelf: "start" }}>
        {open ? <FiChevronDown /> : <FiChevronRight />} Linked debts ({props.debt.linked_debts.length})
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div className="label muted">
            Linked debts (their full principal counts toward this debt's total)
          </div>
          {props.debt.linked_debts.length > 0 && (
            <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
              {props.debt.linked_debts.map((ld) => (
                <li key={ld.id}>
                  {ld.name} ({formatMoney(ld.principal)}
                  {!ld.countsTowardOrigin && (
                    <span className="muted" title="Hasn't started yet — not counted until it has">
                      {" "}
                      · not counted yet
                    </span>
                  )}
                  ){" "}
                  <button
                    className="link-button"
                    onClick={() =>
                      unlinkDebt.mutate({ parentDebtId: props.debt.id, childDebtId: ld.id })
                    }
                    title="Unlink"
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
                <option value="">Link another debt…</option>
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
                <FiLink /> Link
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
  const d = props.debt;
  const tone = d.direction === "owed_by_me" ? "negative" : "positive";
  const directionLabel = d.direction === "owed_by_me" ? "I owe" : "Owed to me";

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8 }}>
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
          {isFutureDebt(d) && <span className="badge">Starts {formatDate(d.start_date)}</span>}
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <div className="label muted">{d.status === "active" ? "Remaining" : "Paid"}</div>
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

const RECENT_PAYOFF_COUNT = 6;
const MAX_PROJECTION_MONTHS = 1200; // 100 years — a sane cap, not a real answer

// "Current rate" means recent behavior, not all-time average — if payments
// used to be small and have since grown (or vice versa), the last few
// actually paid amounts are a better forecast than the full history.
function recentAvgPayment(payOffTx: DebtLinkedTransaction[]): number | null {
  const recent = [...payOffTx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT_PAYOFF_COUNT);
  if (recent.length === 0) return null;
  return recent.reduce((sum, t) => sum + Math.abs(t.amount), 0) / recent.length;
}

// Monthly-equivalent of everything driving the debt's combined plan (every
// linked bill, converted to its own monthly-equivalent, plus the automatic
// heuristic if it's also contributing) — an explicit figure beats a
// historical average anywhere a forecast needs "what will actually be paid
// each month".
function plannedMonthlyPayment(d: Debt): number | null {
  const plan = d.payment_plan;
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

function PayoffProjection(props: { debt: Debt; payOffTx: DebtLinkedTransaction[] }) {
  const d = props.debt;

  const projection = useMemo(() => {
    if (d.status !== "active" || d.remaining <= 0) return null;
    const planned = plannedMonthlyPayment(d);
    const avgMonthlyPayment = planned ?? recentAvgPayment(props.payOffTx);
    if (avgMonthlyPayment == null) return null;

    const monthlyRate = (d.interest_rate_monthly_percent ?? 0) / 100;
    const monthlyInterestCost = d.remaining * monthlyRate;
    if (avgMonthlyPayment <= monthlyInterestCost) {
      return { avgMonthlyPayment, fromPlan: planned != null, months: null, payoffDate: null };
    }

    let balance = d.remaining;
    let months = 0;
    while (balance > 0 && months < MAX_PROJECTION_MONTHS) {
      balance = balance * (1 + monthlyRate) - avgMonthlyPayment;
      months++;
    }
    const payoffDate = new Date();
    payoffDate.setMonth(payoffDate.getMonth() + months);
    return { avgMonthlyPayment, fromPlan: planned != null, months, payoffDate };
  }, [d, props.payOffTx]);

  if (!projection) return null;

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--rule)" }}>
      <div className="label muted">Projected payoff</div>
      {projection.months == null ? (
        <div className="shortfall" style={{ marginTop: 4 }}>
          At {projection.fromPlan ? "the planned payment" : "the recent average payment"} of{" "}
          {formatMoney(projection.avgMonthlyPayment)}/mo, this isn't even covering the interest —
          the balance will keep growing, not shrink.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 4 }}>
            <span style={{ fontWeight: 600 }}>
              {projection.months} month{projection.months === 1 ? "" : "s"}
            </span>{" "}
            <span className="muted">
              (~
              {new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(
                projection.payoffDate!
              )}
              )
            </span>
          </div>
          <div className="muted" style={{ fontSize: "0.85em", marginTop: 2 }}>
            Based on{" "}
            {projection.fromPlan
              ? "the planned payment from the linked bill"
              : "your recent average payment"}{" "}
            of {formatMoney(projection.avgMonthlyPayment)}/mo
            {d.interest_rate_monthly_percent ? ` at ${d.interest_rate_monthly_percent}% monthly interest` : ""}.
          </div>
        </>
      )}
    </div>
  );
}

// 18 months so even a loan starting next year (e.g. the CAIXA mortgage in
// 2027-07) still shows its upcoming payments; only the first few applicable
// months are displayed.
const PLAN_PREVIEW_HORIZON = 18;
const PLAN_PREVIEW_COUNT = 6;

const PLAN_CADENCE_LABEL: Record<Bill["cadence"], string> = {
  weekly: "every week",
  monthly: "every month",
  quarterly: "every quarter",
  yearly: "every year",
  once: "as a single payment",
};

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
            currently pays "{b.debt_name ?? "another debt"}" — checking moves it here
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
        {PLAN_CADENCE_LABEL[b.cadence]}
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
      <div className="label muted">Payment plan</div>
      <div style={{ marginTop: 4 }}>
        {plan.source === "loan" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{formatMoney(plan.monthly_amount)}/mo</span>{" "}
              <span className="muted">
                — computed from the {LOAN_TYPE_LABEL[plan.loan_type]} loan formula:{" "}
                {plan.rate_monthly_percent}% a.m. over {plan.term_months} months
                {plan.loan_type === "sac" && " (the payment declines as principal amortizes)"}.
              </span>
            </div>
            {plan.extra_bills.map((b) => (
              <div key={b.bill_id}>
                <span style={{ fontWeight: 600 }}>{formatMoney(b.amount)}</span>{" "}
                <span className="muted">
                  {PLAN_CADENCE_LABEL[b.cadence]} — extra amortization from the "{b.bill_name}"
                  recurring bill, on top of the installment above.
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
                  {PLAN_CADENCE_LABEL[b.cadence]} — from the "{b.bill_name}" recurring bill.
                </span>
              </div>
            ))}
            {plan.automatic && (
              <div>
                <span style={{ fontWeight: 600 }}>≈{formatMoney(plan.automatic.monthly_amount)}/mo</span>{" "}
                <span className="muted">
                  — inferred from the average of your {plan.automatic.payment_count} linked repayments.
                </span>
              </div>
            )}
            <div className="muted" style={{ fontSize: "0.85em" }}>
              {plan.bills.length > 0 && plan.automatic ? "Combined, each " : ""}
              Bounded by what's still remaining ({formatMoney(d.remaining)}).
            </div>
          </div>
        )}
        {plan.source === "none" && (
          <span className="muted">
            {plan.payment_count < 2
              ? "No schedule yet — fewer than two repayments are linked, so there's no cadence to infer."
              : "No schedule — the linked repayments vary too much to infer a reliable amount."}{" "}
            This debt stays out of cash-flow projections until a payment bill is linked below
            {plan.payment_count < 2 ? " or more repayments accumulate" : ""}.
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
              <div className={`money ${p.amount >= 0 ? "gain" : "shortfall"}`} style={{ fontSize: 13 }}>
                {p.amount >= 0 ? "+" : "-"}
                {formatMoney(Math.abs(p.amount))}
              </div>
            </div>
          ))}
        </div>
      )}
      {preview.length === 0 && plan.source !== "none" && projections && (
        <p className="muted" style={{ fontSize: "0.85em", marginTop: 8, marginBottom: 0 }}>
          No projected payments in the next {PLAN_PREVIEW_HORIZON} months
          {isFutureDebt(d) ? ` — this debt only starts ${formatDate(d.start_date)}` : ""}.
        </p>
      )}

      <div style={{ marginTop: 12 }}>
        <div className="label muted" style={{ marginBottom: 6 }}>
          Paid by recurring bill(s)
        </div>
        {linkableBills.length === 0 ? (
          <p className="muted" style={{ fontSize: "0.85em", margin: 0 }}>
            No confirmed bills available to link yet.
          </p>
        ) : (
          <>
            {linkedBills.length === 0 ? (
              <p className="muted" style={{ fontSize: "0.85em", margin: 0 }}>
                No bills linked yet — link one below to make this debt's payment explicit.
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
                  Link {linkedBills.length > 0 ? "another" : "a"} bill ({candidateBills.length}{" "}
                  available)
                </button>
                {billPickerOpen && (
                  <div style={{ marginTop: 6 }}>
                    {candidateBills.length > 6 && (
                      <input
                        type="text"
                        value={billFilter}
                        onChange={(e) => setBillFilter(e.target.value)}
                        placeholder="Filter by name or category…"
                        style={{ width: "100%", marginBottom: 6 }}
                      />
                    )}
                    {visibleCandidates.length === 0 ? (
                      <p className="muted" style={{ fontSize: "0.85em", margin: 0 }}>
                        No bills match "{billFilter.trim()}".
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
          style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}
          title="Skip the payment-history heuristic even if it would otherwise pass — useful once the bills above are already accounting for this debt's payments."
        >
          <input
            type="checkbox"
            checked={d.override_automatic_schedule}
            onChange={(e) =>
              updateDebt.mutate({ id: d.id, input: { overrideAutomaticSchedule: e.target.checked } })
            }
          />
          Don't infer a schedule from payment history (use only the bills above)
        </label>
      )}
      <p className="muted" style={{ fontSize: "0.85em", marginTop: 6, marginBottom: 0 }}>
        {plan.source === "loan"
          ? "A formal loan's monthly installment always comes from the loan formula, unchanged — but any bill linked here counts as an extra amortization payment on top of it, paying the balance down (and off) faster than the plain schedule alone."
          : "Every linked bill's amount and cadence adds to this debt's expected payment, bounded by what's still remaining — explicit, instead of only inferred from history."}
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

// One debt's month-by-month balance, real history first then projection.
// With an interest rate the history is interest-aware (simulateAmortization);
// without one it's the server-computed remaining stepped back through each
// payment. Projection comes from the loan's own schedule when there is one,
// else the recent-average-payment heuristic. Shared by the per-debt chart and
// the page-level overview so both agree on what a debt's trajectory is.
// A loan-type debt's own PRICE/SAC schedule, but with every extra
// amortization bill linked to it (see DebtPaymentPlan's "loan" variant — the
// computed installment stays authoritative, these are on top of it) counted
// against the same shared remainingBalance cap the backend's projection
// engine uses (see activeDebtSchedules/debtLineAmountForMonth in
// projectionEngine.ts): the installment's own interest/amortization split
// still comes from the plain, extras-ignorant formula every month (the
// contract's fixed payment never changes because of an extra payment), but
// cumulative cash toward the debt — installment plus every extra bill — is
// tracked against startBalance and trims/stops the schedule the moment it's
// exhausted, exactly like the backend does. A naive "recompute interest off
// a balance already reduced by extras" model would pay off measurably slower
// than this and would silently disagree with the real projection.
interface LoanStep {
  balance: number;
  interest: number;
}

function loanStepsWithExtras(
  startBalance: number,
  ratePercent: number,
  loanType: "price" | "sac",
  termMonths: number,
  anchorDate: string,
  extraBills: Bill[]
): LoanStep[] {
  const r = ratePercent / 100;
  const fixedPayment = loanType === "price" ? pricePayment(startBalance, ratePercent, termMonths) : null;
  const fixedAmortization = loanType === "sac" ? startBalance / termMonths : null;
  const steps: LoanStep[] = [];
  let scheduleBalance = startBalance;
  let paidSoFar = 0;
  for (let month = 1; month <= termMonths && paidSoFar < startBalance - 0.005; month++) {
    // Aligned with the backend's own monthOfLoan convention (see
    // debtLineAmountForMonth in projectionEngine.ts): loan-month 1 is the
    // start date's own calendar month, not the month after — so an extra
    // bill due in the same month the loan starts (like a closing-day upfront
    // payment) fires on loan-month 1, matching the real projection exactly.
    const targetMonth = localMonthDate(anchorDate, month - 1);
    const interest = scheduleBalance * r;
    const amort = fixedPayment != null ? fixedPayment - interest : fixedAmortization!;
    const rawPayment = interest + amort;
    scheduleBalance = Math.max(0, scheduleBalance - amort);

    const cappedPayment = Math.min(rawPayment, startBalance - paidSoFar);
    if (cappedPayment <= 0.005) break;
    const interestThisMonth = cappedPayment < rawPayment ? interest * (cappedPayment / rawPayment) : interest;
    paidSoFar += cappedPayment;

    let extraThisMonth = 0;
    if (paidSoFar < startBalance - 0.005) {
      const extra = extraBills.reduce((sum, b) => {
        const info = {
          cadence: b.cadence,
          nextDueDate: b.next_due_date,
          recurrenceStartDate: b.recurrence_start_date,
          recurrenceEndDate: b.recurrence_end_date,
        };
        if (!billAppliesToMonth(info, targetMonth)) return sum;
        return sum + monthlyEquivalentAmount({ cadence: b.cadence, expectedAmount: b.expected_amount }, undefined);
      }, 0);
      extraThisMonth = Math.min(extra, startBalance - paidSoFar);
      paidSoFar += extraThisMonth;
    }
    steps.push({ balance: Math.max(0, startBalance - paidSoFar), interest: interestThisMonth });
  }
  return steps;
}

function debtBalanceSeries(
  d: Debt,
  payOffTx: DebtLinkedTransaction[],
  today: string,
  extraBills: Bill[] = []
): BalancePoint[] {
  const rate = d.interest_rate_monthly_percent;
  const hasRate = rate != null && rate > 0 && d.principal > 0;

  // Hasn't started yet — there's no "actual" portion at all, only whatever can
  // be projected forward from the debt's own future start date: the loan's own
  // schedule if it has one, else the planned-payment amortization loop.
  if (d.start_date > today) {
    if (d.status !== "active") return [];
    const hasSchedule = hasRate && d.loan_type != null && d.target_payoff_date != null;
    const r = hasRate ? rate! / 100 : 0;
    const avg = hasSchedule ? null : plannedMonthlyPayment(d);
    if (!hasSchedule && !(avg != null && avg > 0 && avg > d.principal * r)) return [];

    const points: BalancePoint[] = [{ date: d.start_date, balance: d.principal, kind: "projected" }];
    if (hasSchedule) {
      let term = 0;
      while (term < MAX_CHART_MONTHS && addMonthsIso(d.start_date, term + 1) <= d.target_payoff_date!) term++;
      loanStepsWithExtras(d.principal, rate!, d.loan_type!, Math.max(1, term), d.start_date, extraBills).forEach(
        (step, i) => points.push({ date: addMonthsIso(d.start_date, i + 1), balance: step.balance, kind: "projected" })
      );
    } else {
      let balance = d.principal;
      while (balance > 0 && points.length - 1 < MAX_CHART_MONTHS) {
        balance = Math.max(0, balance * (1 + r) - avg!);
        points.push({ date: addMonthsIso(d.start_date, points.length), balance, kind: "projected" });
      }
    }
    return points;
  }

  const payments = payOffTx.map((t) => ({ id: t.id, date: t.date, amount: Math.abs(t.amount) }));

  let elapsed = 0;
  while (elapsed < MAX_CHART_MONTHS && addMonthsIso(d.start_date, elapsed + 1) <= today) elapsed++;

  // A debt marked paid off is settled, whatever its arithmetic remaining says.
  const anchor = d.status === "paid_off" ? 0 : Math.max(0, d.remaining);
  const points: BalancePoint[] = [];
  for (let m = 0; m <= elapsed; m++) {
    const date = addMonthsIso(d.start_date, m);
    const balance = hasRate
      ? Math.max(
          0,
          simulateAmortization(
            d.principal,
            rate!,
            d.start_date,
            payments.filter((p) => p.date <= date),
            date
          ).currentPayoffBalance
        )
      : Math.max(0, anchor + payments.filter((p) => p.date > date).reduce((sum, p) => sum + p.amount, 0));
    points.push({ date, balance, kind: "actual" });
  }

  const anchorBalance = points[points.length - 1].balance;
  if (d.status !== "active" || anchorBalance <= 0.005) return points;

  const anchorDate = points[points.length - 1].date;
  const hasSchedule = hasRate && d.loan_type != null && d.target_payoff_date != null;
  let futureBalances: number[] = [];
  if (hasSchedule) {
    let term = 0;
    while (term < MAX_CHART_MONTHS && addMonthsIso(anchorDate, term + 1) <= d.target_payoff_date!) term++;
    futureBalances = loanStepsWithExtras(
      anchorBalance,
      rate!,
      d.loan_type!,
      Math.max(1, term),
      anchorDate,
      extraBills
    ).map((step) => step.balance);
  } else {
    const avg = plannedMonthlyPayment(d) ?? recentAvgPayment(payOffTx);
    const r = hasRate ? rate! / 100 : 0;
    if (avg != null && avg > 0 && avg > anchorBalance * r) {
      let balance = anchorBalance;
      while (balance > 0 && futureBalances.length < MAX_CHART_MONTHS) {
        balance = Math.max(0, balance * (1 + r) - avg);
        futureBalances.push(balance);
      }
    }
  }
  futureBalances.forEach((balance, i) =>
    points.push({ date: addMonthsIso(anchorDate, i + 1), balance, kind: "projected" })
  );
  return points;
}

interface TrajectoryPoint {
  label: string;
  ifUnpaid: number | null;
  actual: number | null;
  projected: number | null;
}

// Two tiers. With an interest rate, the argument for paying made visible: one
// line is this debt left to compound with nothing ever paid, the other is the
// balance with payments — the widening gap is what paying it down is worth.
// Without a rate there's no hypothetical-growth line to draw, but the real
// balance declining through each repayment (plus the average-payment
// projection) is still the story; with fewer than two payments there's no
// story at all, so a short note stands in for the chart.
function DebtTrajectoryChart(props: { debt: Debt; payOffTx: DebtLinkedTransaction[] }) {
  const d = props.debt;
  const { payOffTx } = props;
  const { data: bills } = useBills();
  const extraBills = useMemo(() => (bills ?? []).filter((b) => b.debt_id === d.id), [bills, d.id]);

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

    const series = debtBalanceSeries(d, payOffTx, today, extraBills);
    if (series.length < 2) return null;

    const r = hasRate ? rate! / 100 : 0;
    const hasProjection = series[series.length - 1].kind === "projected";
    let lastActualIdx = 0;
    series.forEach((p, i) => {
      if (p.kind === "actual") lastActualIdx = i;
    });

    // Series points are exactly one month apart from start_date, so the index
    // doubles as "months elapsed" for the compounding line.
    const points: TrajectoryPoint[] = series.map((p, i) => ({
      label: chartMonthLabel.format(new Date(p.date)),
      ifUnpaid: hasRate ? d.principal * (1 + r) ** i : null,
      actual: p.kind === "actual" ? p.balance : null,
      projected: p.kind === "projected" || (hasProjection && i === lastActualIdx) ? p.balance : null,
    }));

    // Hypothetical minus actual minus everything paid in = the compounding
    // dodged purely by keeping the balance low — not just the money put in.
    let avoided: { amount: number; ifUnpaidNow: number; actualNow: number } | null = null;
    if (hasRate && payOffTx.length > 0 && d.direction === "owed_by_me") {
      const payments = payOffTx.map((t) => ({ id: t.id, date: t.date, amount: Math.abs(t.amount) }));
      const sim = simulateAmortization(d.principal, rate!, d.start_date, payments, today);
      const monthsNow = Math.max(0, (Date.parse(today) - Date.parse(d.start_date)) / (1000 * 60 * 60 * 24) / 30.44);
      const ifUnpaidNow = d.principal * (1 + r) ** monthsNow;
      const actualNow = Math.max(0, sim.currentPayoffBalance);
      const amount = ifUnpaidNow - actualNow - (sim.totalInterestPaid + sim.totalPrincipalPaid);
      if (amount > 0.5) avoided = { amount, ifUnpaidNow, actualNow };
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
              totalPaid: d.principal + (d.interest_paid_so_far ?? 0) + d.projected_remaining_interest,
              reachesPayoff: d.projected_finish_date != null,
            }
          : null,
    };
  }, [d, payOffTx, extraBills]);

  if (!chart) {
    if (d.status !== "active" || isFutureDebt(d)) return null;
    return (
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--rule)" }}>
        <p className="muted" style={{ fontSize: "0.85em", margin: 0 }}>
          Not enough history to chart yet — once a couple of repayments are linked, this debt's
          balance-over-time chart appears here.
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--rule)" }}>
      <div className="label muted">
        {chart.isFuture
          ? "Projected schedule (hasn't started yet)"
          : chart.hasRate
            ? "Growing with interest vs being paid off"
            : "Balance over time"}
      </div>
      {chart.avoided && (
        <div style={{ marginTop: 4 }}>
          <span style={{ fontWeight: 600 }}>{formatMoney(chart.avoided.amount)}</span>{" "}
          <span className="muted">
            of interest avoided so far — untouched, this debt would be{" "}
            {formatMoney(chart.avoided.ifUnpaidNow)} today instead of {formatMoney(chart.avoided.actualNow)}.
          </span>
        </div>
      )}
      <div className="chart-container" style={{ height: 240, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart.points}>
            <XAxis dataKey="label" stroke="var(--text-muted)" minTickGap={24} />
            <YAxis stroke="var(--text-muted)" tickFormatter={compactMoney} />
            <Tooltip formatter={moneyTooltip} />
            {(chart.hasRate || chart.hasProjection) && <Legend />}
            {chart.todayLabel && <ReferenceLine x={chart.todayLabel} stroke="var(--rule)" />}
            {chart.hasRate && (
              <Line
                type="monotone"
                dataKey="ifUnpaid"
                name="If never paid"
                stroke="var(--danger)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
              />
            )}
            <Line
              type="monotone"
              dataKey="actual"
              name="Balance (real)"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
            />
            {chart.hasProjection && (
              <Line
                type="monotone"
                dataKey="projected"
                name="Balance (projected)"
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
        {chart.isFuture ? (
          <>
            This debt hasn't started yet, so there's no real history — the whole line is projected
            {chart.projectionSource === "schedule"
              ? " from the loan's own schedule"
              : chart.projectionSource === "bill"
                ? " from the linked payment bill"
                : " from the planned payment"}
            , starting from its own start date.
          </>
        ) : chart.hasRate ? (
          <>
            The rust line is this debt compounding at {chart.rate}% a month with nothing ever paid;
            the green line is the balance with payments — solid where real
            {chart.hasProjection &&
              (chart.projectionSource === "schedule"
                ? ", dashed where projected from the loan's own schedule"
                : chart.projectionSource === "bill"
                  ? ", dashed where projected from the linked payment bill"
                  : ", dashed where projected from your recent average payment")}
            . The gap between them is what paying it down is worth.
          </>
        ) : (
          <>
            The remaining balance as each repayment posted — solid where real
            {chart.hasProjection &&
              (chart.projectionSource === "bill"
                ? ", dashed where projected from the linked payment bill"
                : ", dashed where projected from your recent average payment")}
            .
          </>
        )}
      </p>
      {chart.lifetimeTotals && (
        <div
          style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--rule)" }}
        >
          <div>
            <div className="label muted" style={{ fontSize: 11 }}>
              Total interest {chart.lifetimeTotals.reachesPayoff ? "over the life of this debt" : "so far + projected"}
            </div>
            <div style={{ fontWeight: 600 }}>{formatMoney(chart.lifetimeTotals.totalInterest)}</div>
          </div>
          <div>
            <div className="label muted" style={{ fontSize: 11 }}>
              Total paid {chart.lifetimeTotals.reachesPayoff ? "by payoff" : "so far + projected"}
            </div>
            <div style={{ fontWeight: 600 }}>{formatMoney(chart.lifetimeTotals.totalPaid)}</div>
          </div>
          {!chart.lifetimeTotals.reachesPayoff && (
            <p className="muted" style={{ fontSize: "0.8em", margin: 0, flexBasis: "100%" }}>
              The planned payment doesn't clearly outpace interest, so this is only a running total
              through the charted horizon above, not a true end-of-loan figure.
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
  const { data: bills } = useBills();

  // Same query keys as useDebtTransactions, so this shares the cache with the
  // per-debt detail view instead of refetching when a tile is opened.
  const txQueries = useQueries({
    queries: relevant.map((d) => ({
      queryKey: ["debts", d.id, "transactions"],
      queryFn: () => apiFetch<DebtLinkedTransaction[]>(`/api/debts/${d.id}/transactions`),
    })),
  });
  const loaded = relevant.length > 0 && txQueries.every((q) => q.data !== undefined);
  // useQueries returns a fresh array every render; this stamp only changes
  // when a query actually delivers new data, so the memo below holds.
  const txStamp = txQueries.map((q) => q.dataUpdatedAt).join("|");

  const chart = useMemo(() => {
    if (!loaded) return null;
    const seriesByDebt = relevant
      .map((d, i) => ({
        debt: d,
        series: debtBalanceSeries(
          d,
          (txQueries[i].data ?? []).filter((t) => t.role === "pay_off"),
          today,
          (bills ?? []).filter((b) => b.debt_id === d.id)
        ),
      }))
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
  }, [loaded, txStamp, props.debts, bills]);

  if (!chart) return null;

  return (
    <div className="card">
      <div className="label muted">All debts — balance over time</div>
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
                name="I owe (real)"
                stroke="var(--danger)"
                strokeWidth={2}
                dot={false}
              />
            )}
            {chart.hasOwed && chart.hasProjection && (
              <Line
                type="monotone"
                dataKey="owedProjected"
                name="I owe (projected)"
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
                name="Owed to me (real)"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={false}
              />
            )}
            {chart.hasLent && chart.hasProjection && (
              <Line
                type="monotone"
                dataKey="lentProjected"
                name="Owed to me (projected)"
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
        Every debt summed by direction — rust is what you owe, green is owed to you (kept separate,
        not netted). Solid is real history; dashed carries each debt forward on its own schedule or
        recent payments, holding flat where there's nothing to project from.
      </p>
    </div>
  );
}

function DebtCard(props: { debt: Debt; allDebts: Debt[] }) {
  const [expanded, setExpanded] = useState(false);
  // Loaded unconditionally (not just when expanded) so the interest rate
  // editor can compute a live preview as you type.
  const { data: linkedTx } = useDebtTransactions(props.debt.id);
  const payOffTx = useMemo(() => (linkedTx ?? []).filter((t) => t.role === "pay_off"), [linkedTx]);
  const showInterestColumn = payOffTx.some((t) => t.interest != null && t.interest > 0.005);
  const finishDate = props.debt.projected_finish_date;
  const {
    sorted: sortedLinkedTx,
    sortKey: linkedSortKey,
    direction: linkedSortDirection,
    toggleSort: toggleLinkedSort,
  } = useSortableTable<DebtLinkedTransaction>(
    linkedTx ?? [],
    (t, key) => {
      switch (key) {
        case "description":
          return t.description;
        case "amount":
          return t.amount;
        case "interest":
          return t.interest ?? 0;
        case "role":
          return t.role;
        default:
          return t.date;
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
  const directionLabel = d.direction === "owed_by_me" ? "I owe" : "Owed to me";

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>
          {d.name}
          {d.counterparty && <span className="muted"> — {d.counterparty}</span>}
        </h3>
        <span style={{ color: tone === "negative" ? "var(--danger)" : "var(--accent)", fontWeight: 600 }}>
          {directionLabel}
        </span>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 16, marginTop: 12 }}
      >
        <StartDateEditor debt={d} />
        <PrincipalEditor debt={d} />
        <div>
          <div className="label muted">Paid so far</div>
          <div className="money">{formatMoney(d.total_paid)}</div>
        </div>
        {!isFutureDebt(d) && (
          <div>
            <div className="label muted">Remaining</div>
            <div className="money">{formatMoney(d.remaining)}</div>
            {d.remaining_interest != null && (
              <div className="muted" style={{ fontSize: "0.85em" }}>
                of which {formatMoney(d.remaining_interest)} interest
              </div>
            )}
          </div>
        )}
        {d.interest_paid_so_far != null && (
          <div>
            <div className="label muted">Interest paid</div>
            <div className="money">{formatMoney(d.interest_paid_so_far)}</div>
          </div>
        )}
        {d.split_percentage != null && (
          <div>
            <div className="label muted">Split</div>
            <div className="money">{d.split_percentage}%</div>
          </div>
        )}
        {finishDate && (
          <div>
            <div className="label muted">Finish date</div>
            <div className="money">{formatDate(finishDate)}</div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <ProgressBar percent={d.percent_complete} tone={tone} />
      </div>

      <PaymentPlanSection debt={d} />

      <PayoffProjection debt={d} payOffTx={payOffTx} />

      <DebtTrajectoryChart debt={d} payOffTx={payOffTx} />

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
        <button className="link-button" onClick={() => setExpanded((e) => !e)} style={{ alignSelf: "start" }}>
          {expanded ? <FiChevronDown /> : <FiChevronRight />} Linked transactions ({d.transaction_count})
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
            Mark paid off
          </button>
        ) : (
          <span className="muted">Paid off</span>
        )}
        <button
          className="danger icon"
          style={{ marginLeft: "auto" }}
          onClick={() => deleteDebt.mutate(d.id)}
          title="Delete"
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
                  <SortableTh label="Date" sortKey="date" activeKey={linkedSortKey} direction={linkedSortDirection} onSort={toggleLinkedSort} />
                  <SortableTh label="Description" sortKey="description" activeKey={linkedSortKey} direction={linkedSortDirection} onSort={toggleLinkedSort} />
                  <SortableTh label="Amount" sortKey="amount" activeKey={linkedSortKey} direction={linkedSortDirection} onSort={toggleLinkedSort} />
                  {showInterestColumn && (
                    <SortableTh label="Interest" sortKey="interest" activeKey={linkedSortKey} direction={linkedSortDirection} onSort={toggleLinkedSort} />
                  )}
                  <SortableTh label="Role" sortKey="role" activeKey={linkedSortKey} direction={linkedSortDirection} onSort={toggleLinkedSort} />
                  <th />
                </tr>
              </thead>
              <tbody>
                {sortedLinkedTx.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDate(t.date)}</td>
                    <td>{t.description}</td>
                    <td className="money">{formatMoney(t.amount, t.currency_code)}</td>
                    {showInterestColumn && (
                      <td className="money">
                        {t.interest != null && t.interest > 0.005 ? formatMoney(t.interest) : "—"}
                      </td>
                    )}
                    <td>{t.role}</td>
                    <td>
                      <button
                        className="link-button"
                        onClick={() => unlink.mutate({ debtId: d.id, transactionIds: [t.id] })}
                        title="Unlink"
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
            linkedIds={new Set((linkedTx ?? []).map((t) => t.id))}
          />
        </>
      )}
    </div>
  );
}

export function DebtsPage() {
  const { data: debts } = useDebts();
  const createDebt = useCreateDebt();

  const [name, setName] = useState("");
  const [direction, setDirection] = useState<(typeof DIRECTIONS)[number]["value"]>("owed_by_me");
  const [counterparty, setCounterparty] = useState("");
  const [mode, setMode] = useState<"fixed" | "split">("fixed");
  const [principalAmount, setPrincipalAmount] = useState("");
  const [splitPercentage, setSplitPercentage] = useState("");
  const [expectedTotalAmount, setExpectedTotalAmount] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [targetPayoffDate, setTargetPayoffDate] = useState("");
  const [loanType, setLoanType] = useState<(typeof LOAN_TYPES)[number]["value"]>("");
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
        <button className="secondary" onClick={() => setSelectedDebtId(null)} style={{ alignSelf: "start" }}>
          <FiArrowLeft /> Back to all debts
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
          <h2>Active</h2>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
            {active.map((d) => (
              <DebtTile key={d.id} debt={d} onSelect={() => setSelectedDebtId(d.id)} />
            ))}
          </div>
        </div>
      )}

      {future.length > 0 && (
        <div className="grid" style={{ gap: 16 }}>
          <h2>Future</h2>
          <p className="muted" style={{ margin: 0 }}>
            Hasn't started yet — its start date is still ahead.
          </p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
            {future.map((d) => (
              <DebtTile key={d.id} debt={d} onSelect={() => setSelectedDebtId(d.id)} />
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <button className="disclosure" onClick={() => setAddOpen((o) => !o)}>
          {addOpen ? <FiChevronDown /> : <FiChevronRight />} Add a debt
        </button>
        {addOpen && (
          <div style={{ marginTop: 12 }}>
        <p className="muted">
          A fixed principal is for a simple loan. A split percentage is for a shared expense you
          fronted (e.g. a house-build cost split 50/50) — link the shared purchase transaction(s) as
          "borrow"/"lend" and the amount owed grows automatically as you link more.
        </p>
        <form onSubmit={submit} className="grid" style={{ gridTemplateColumns: "repeat(4, auto)", alignItems: "end", gap: 16 }}>
          <label>
            Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Direction
            <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
              {DIRECTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Counterparty
            <input type="text" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
          </label>
          <label>
            Principal mode
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="fixed">Fixed amount</option>
              <option value="split">Split % of linked transactions</option>
            </select>
          </label>
          {mode === "fixed" ? (
            <label>
              Principal amount
              <input
                type="number"
                step="0.01"
                value={principalAmount}
                onChange={(e) => setPrincipalAmount(e.target.value)}
              />
            </label>
          ) : (
            <label>
              Split percentage
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
            Expected total (with interest)
            <input
              type="number"
              step="0.01"
              placeholder="optional"
              value={expectedTotalAmount}
              onChange={(e) => setExpectedTotalAmount(e.target.value)}
            />
          </label>
          <label>
            Start date
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </label>
          <label>
            Target payoff date
            <input
              type="date"
              value={targetPayoffDate}
              onChange={(e) => setTargetPayoffDate(e.target.value)}
            />
          </label>
          <label>
            Loan type
            <select value={loanType} onChange={(e) => setLoanType(e.target.value as typeof loanType)}>
              {LOAN_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">
            <FiPlus /> Add debt
          </button>
        </form>
        <label style={{ display: "block", marginTop: 16 }}>
          Matching rule (optional, can add later)
          <textarea
            value={matchingRule}
            onChange={(e) => setMatchingRule(e.target.value)}
            placeholder="Exactly how to classify future transactions against this debt — e.g. counterparty pattern, amount threshold, role."
            rows={2}
            style={{ width: "100%", resize: "vertical" }}
          />
        </label>
          </div>
        )}
      </div>

      {paidOff.length > 0 && (
        <div className="grid" style={{ gap: 16 }}>
          <h2>Paid off</h2>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
            {paidOff.map((d) => (
              <DebtTile key={d.id} debt={d} onSelect={() => setSelectedDebtId(d.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
