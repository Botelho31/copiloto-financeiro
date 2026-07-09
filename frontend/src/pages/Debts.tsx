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
import type { Debt, DebtLinkedTransaction } from "shared";
import { priceSchedule, sacSchedule, simulateAmortization } from "shared";
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
import { useSearchTransactions } from "../hooks/useTransactions";
import { apiFetch } from "../lib/api";
import { useSortableTable } from "../hooks/useSortableTable";
import { SortableTh } from "../components/SortableTh";
import { formatDate, formatMoney } from "../lib/format";

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
                  {ld.name} ({formatMoney(ld.principal)}){" "}
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

function PayoffProjection(props: { debt: Debt; payOffTx: DebtLinkedTransaction[] }) {
  const d = props.debt;

  const projection = useMemo(() => {
    if (d.status !== "active" || d.remaining <= 0) return null;
    const avgMonthlyPayment = recentAvgPayment(props.payOffTx);
    if (avgMonthlyPayment == null) return null;

    const monthlyRate = (d.interest_rate_monthly_percent ?? 0) / 100;
    const monthlyInterestCost = d.remaining * monthlyRate;
    if (avgMonthlyPayment <= monthlyInterestCost) {
      return { avgMonthlyPayment, months: null, payoffDate: null };
    }

    let balance = d.remaining;
    let months = 0;
    while (balance > 0 && months < MAX_PROJECTION_MONTHS) {
      balance = balance * (1 + monthlyRate) - avgMonthlyPayment;
      months++;
    }
    const payoffDate = new Date();
    payoffDate.setMonth(payoffDate.getMonth() + months);
    return { avgMonthlyPayment, months, payoffDate };
  }, [d.status, d.remaining, d.interest_rate_monthly_percent, props.payOffTx]);

  if (!projection) return null;

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--rule)" }}>
      <div className="label muted">Projected payoff</div>
      {projection.months == null ? (
        <div className="shortfall" style={{ marginTop: 4 }}>
          At the recent average payment of {formatMoney(projection.avgMonthlyPayment)}/mo, this isn't
          even covering the interest — the balance will keep growing, not shrink.
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
            Based on your recent average payment of {formatMoney(projection.avgMonthlyPayment)}/mo
            {d.interest_rate_monthly_percent ? ` at ${d.interest_rate_monthly_percent}% monthly interest` : ""}.
          </div>
        </>
      )}
    </div>
  );
}

const MAX_CHART_MONTHS = 360; // 30 years of monthly points is plenty for a plot

const chartMonthLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

// Day clamped to 28 so stepping month-by-month never skips a short month
// (Jan 31 + 1 month would otherwise land in March).
function addMonthsIso(startIso: string, n: number): string {
  const [y, m, day] = startIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, Math.min(day, 28))).toISOString().slice(0, 10);
}

function compactMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

function moneyTooltip(value: any): string {
  return formatMoney(Number(value));
}

interface TrajectoryPoint {
  label: string;
  ifUnpaid: number;
  actual: number | null;
  projected: number | null;
}

// The argument for paying, made visible: one line is this debt left to
// compound with nothing ever paid, the other is the balance with payments —
// real ones up to today, then the loan's own schedule (or the recent-average-
// payment heuristic) out to payoff. The widening gap is what paying it down
// is worth.
function DebtTrajectoryChart(props: { debt: Debt; payOffTx: DebtLinkedTransaction[] }) {
  const d = props.debt;
  const { payOffTx } = props;

  const chart = useMemo(() => {
    const rate = d.interest_rate_monthly_percent;
    if (rate == null || rate <= 0 || d.principal <= 0) return null;
    const payments = payOffTx.map((t) => ({ id: t.id, date: t.date, amount: Math.abs(t.amount) }));
    const hasSchedule = d.loan_type != null && d.target_payoff_date != null;
    if (payments.length === 0 && !hasSchedule) return null;

    const today = new Date().toISOString().slice(0, 10);
    const r = rate / 100;
    const ifUnpaidAt = (m: number) => d.principal * (1 + r) ** m;

    let elapsed = 0;
    while (elapsed < MAX_CHART_MONTHS && addMonthsIso(d.start_date, elapsed + 1) <= today) elapsed++;

    const points: TrajectoryPoint[] = [];
    for (let m = 0; m <= elapsed; m++) {
      const date = addMonthsIso(d.start_date, m);
      const actual =
        date <= today
          ? Math.max(
              0,
              simulateAmortization(
                d.principal,
                rate,
                d.start_date,
                payments.filter((p) => p.date <= date),
                date
              ).currentPayoffBalance
            )
          : null;
      points.push({ label: chartMonthLabel.format(new Date(date)), ifUnpaid: ifUnpaidAt(m), actual, projected: null });
    }

    const lastReal = points[elapsed].actual;
    const anchorBalance = lastReal ?? d.principal;

    let futureBalances: number[] = [];
    if (d.status === "active" && anchorBalance > 0.005) {
      if (hasSchedule) {
        const anchorDate = addMonthsIso(d.start_date, elapsed);
        let term = 0;
        while (term < MAX_CHART_MONTHS && addMonthsIso(anchorDate, term + 1) <= d.target_payoff_date!) term++;
        futureBalances = (d.loan_type === "price" ? priceSchedule : sacSchedule)(
          anchorBalance,
          rate,
          Math.max(1, term)
        ).map((row) => row.balance);
      } else {
        const avg = recentAvgPayment(payOffTx);
        if (avg != null && avg > anchorBalance * r) {
          let balance = anchorBalance;
          while (balance > 0 && futureBalances.length < MAX_CHART_MONTHS) {
            balance = Math.max(0, balance * (1 + r) - avg);
            futureBalances.push(balance);
          }
        }
      }
    }

    if (futureBalances.length > 0) {
      points[elapsed].projected = anchorBalance;
      futureBalances.forEach((balance, i) => {
        const m = elapsed + 1 + i;
        points.push({
          label: chartMonthLabel.format(new Date(addMonthsIso(d.start_date, m))),
          ifUnpaid: ifUnpaidAt(m),
          actual: null,
          projected: balance,
        });
      });
    }

    if (points.length < 2) return null;

    // Hypothetical minus actual minus everything paid in = the compounding
    // dodged purely by keeping the balance low — not just the money put in.
    let avoided: { amount: number; ifUnpaidNow: number; actualNow: number } | null = null;
    if (lastReal != null && payments.length > 0 && d.direction === "owed_by_me") {
      const sim = simulateAmortization(d.principal, rate, d.start_date, payments, today);
      const monthsNow = Math.max(0, (Date.parse(today) - Date.parse(d.start_date)) / (1000 * 60 * 60 * 24) / 30.44);
      const ifUnpaidNow = d.principal * (1 + r) ** monthsNow;
      const actualNow = Math.max(0, sim.currentPayoffBalance);
      const amount = ifUnpaidNow - actualNow - (sim.totalInterestPaid + sim.totalPrincipalPaid);
      if (amount > 0.5) avoided = { amount, ifUnpaidNow, actualNow };
    }

    const hasReal = points.some((p) => p.actual != null);
    return {
      points,
      avoided,
      hasReal,
      hasProjection: futureBalances.length > 0,
      todayLabel: hasReal && futureBalances.length > 0 ? points[elapsed].label : null,
      projectionSource: hasSchedule ? ("schedule" as const) : ("heuristic" as const),
      rate,
    };
  }, [d, payOffTx]);

  if (!chart) return null;

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--rule)" }}>
      <div className="label muted">Growing with interest vs being paid off</div>
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
            <Legend />
            {chart.todayLabel && <ReferenceLine x={chart.todayLabel} stroke="var(--rule)" />}
            <Line
              type="monotone"
              dataKey="ifUnpaid"
              name="If never paid"
              stroke="var(--danger)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
            />
            {chart.hasReal && (
              <Line
                type="monotone"
                dataKey="actual"
                name="Balance (real)"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={false}
              />
            )}
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
        The rust line is this debt compounding at {chart.rate}% a month with nothing ever paid; the
        green line is the balance with payments — solid where real
        {chart.hasProjection &&
          (chart.projectionSource === "schedule"
            ? ", dashed where projected from the loan's own schedule"
            : ", dashed where projected from your recent average payment")}
        . The gap between them is what paying it down is worth.
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
        <div>
          <div className="label muted">Start date</div>
          <div className="money">
            {formatDate(d.start_date)}
            {isFutureDebt(d) && <span className="muted"> (future)</span>}
          </div>
        </div>
        <div>
          <div className="label muted">Principal</div>
          <div className="money">{formatMoney(d.principal)}</div>
        </div>
        <div>
          <div className="label muted">Paid so far</div>
          <div className="money">{formatMoney(d.total_paid)}</div>
        </div>
        <div>
          <div className="label muted">Remaining</div>
          <div className="money">{formatMoney(d.remaining)}</div>
          {d.remaining_interest != null && (
            <div className="muted" style={{ fontSize: "0.85em" }}>
              of which {formatMoney(d.remaining_interest)} interest
            </div>
          )}
        </div>
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
      </div>

      <div style={{ marginTop: 12 }}>
        <ProgressBar percent={d.percent_complete} tone={tone} />
      </div>

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
