import { useCallback, useEffect, useMemo, useState } from "react";
import { FiChevronDown, FiChevronRight, FiX } from "react-icons/fi";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ProjectedMonth, ProjectionResult } from "shared";
import { GroupedTransactionList } from "../components/GroupedTransactionList";
import { PeriodPicker } from "../components/PeriodPicker";
import { SortableTransactionTable } from "../components/SortableTransactionTable";
import { SummaryCard } from "../components/SummaryCard";
import { useAccounts } from "../hooks/useAccounts";
import { useCategories } from "../hooks/useCategories";
import { useInvestments } from "../hooks/useInvestments";
import { useProjections } from "../hooks/useProjections";
import { useSettings } from "../hooks/useSettings";
import { useTags } from "../hooks/useTags";
import { useEarliestTransactionDate, useTransactions } from "../hooks/useTransactions";
import { formatMoney } from "../lib/format";
import { computeNetWorth } from "../lib/netWorth";
import { monthsInPeriod, parseIsoDate, periodFor, toIsoDate, type Period } from "../lib/period";

const FALLBACK_CATEGORY_COLOR = "#6b6b6b";
const CARD_COLORS = ["#b5542d", "#5f7fbf", "#8c6a9c", "#4a9c8f", "#c9a227"];

// Review mode's "vs usual pace" verdict needs a trailing baseline that
// predates the viewed period itself — module-level so both the transaction
// fetch (which must actually request that earlier window) and the
// reviewVerdict/categoryAnomalies computations agree on the same window.
const REVIEW_LOOKBACK_MONTHS = 3;

// The Projections page already computes a month-by-month breakdown (bills,
// debts, interest, card spend) — the Dashboard just needs to look a given
// calendar month up in that same data, never recompute any of it itself.
// Every "what's expected" spot on this page goes through these two
// functions so there's exactly one place that knows how to read a
// ProjectedMonth, instead of three slightly-different copies of the same
// find-by-label-and-sum logic.
function findProjectedMonth(
  projections: ProjectionResult | undefined,
  date: Date
): ProjectedMonth | undefined {
  if (!projections) return undefined;
  const label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return projections.months.find((m) => m.label === label);
}

interface ExpectedLine {
  id: number;
  name: string;
  amount: number;
  // Present on a real ProjectedMonth.bills line or a cardExpenseBills entry;
  // absent (never populated) only in the sense that a "debt" line with no
  // linked bill carries category_name: null rather than a real name — see
  // planningCategoryBreakdown's categoryFor for how that's resolved.
  category_name?: string | null;
  kind?: "bill" | "debt" | "interest" | "cardSpend";
}

// Two different confidence tiers, not one flat "faded = future": committed
// is a real recurring bill, a debt's own known repayment schedule, or
// interest on a real balance — things that will happen essentially as
// stated. Assumed is the card-spend goal/average standing in for spend that
// hasn't happened yet, plus any bill specifically flagged as a future card
// expense with no transaction history of its own (e.g. a planned trip) —
// both are estimates, not facts, and shouldn't be visually conflated with
// the committed tier.
function splitCommittedAssumed(month: ProjectedMonth | undefined): {
  committed: ExpectedLine[];
  assumed: ExpectedLine[];
} {
  if (!month) return { committed: [], assumed: [] };
  const committed = month.bills.filter(
    (b) => b.kind === "bill" || b.kind === "debt" || b.kind === "interest"
  );
  const assumed: ExpectedLine[] = [
    ...month.bills.filter((b) => b.kind === "cardSpend"),
    ...month.cardExpenseBills,
  ];
  return { committed, assumed };
}

function sumIncomeExpense(lines: ExpectedLine[]): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  for (const line of lines) {
    if (line.amount >= 0) income += line.amount;
    else expense += -line.amount;
  }
  return { income, expense };
}

// cardExpenseBills (e.g. a known future trip charged to a card) are
// deliberately left out of a ProjectedMonth's own net/bills — that's so the
// Projections page's cash-flow numbers don't double-count them against the
// card-spend goal they're already folded into. But anywhere on the
// Dashboard asking "what's expected," leaving them out would understate it,
// so they're merged back in here, in the one place responsible for that.
function expectedBreakdown(month: ProjectedMonth | undefined): {
  income: number;
  expense: number;
  lines: ExpectedLine[];
  committed: ExpectedLine[];
  assumed: ExpectedLine[];
} {
  const { committed, assumed } = splitCommittedAssumed(month);
  const lines = [...committed, ...assumed];
  const { income, expense } = sumIncomeExpense(lines);
  return { income, expense, lines, committed, assumed };
}

// Narrower than expectedBreakdown on purpose: this is specifically "what's
// expected to hit a card" (for the per-card spending chart), so it takes
// only recurring expense bills and cardExpenseBills — not debts (Estudio
// Foz is paid by bank transfer, not a card) or the card-spend goal/average
// line itself (that's the real per-card bars' own job, not something to
// double up as "expected" on top of them).
function expectedCardCharges(month: ProjectedMonth | undefined): {
  committed: number;
  assumed: number;
} {
  if (!month) return { committed: 0, assumed: 0 };
  // Committed: a real recurring bill with actual transaction history (e.g.
  // Nubank Ultravioleta) — about as sure as "future" gets. Assumed: a bill
  // flagged as a future card expense with no history of its own yet (e.g. a
  // planned trip), PLUS the general card-spend goal/average itself — the
  // catch-all for typical discretionary charges (groceries, dining,
  // shopping) that haven't posted yet. That average is computed excluding
  // amounts already matched to confirmed bills (see cardSpendBaseline on the
  // backend), so adding it alongside the named committed bills doesn't
  // double-count either side. Without it, a future month with barely any
  // real card data yet (just a pre-scheduled installment or two) reads as
  // nearly empty instead of showing what's actually expected.
  const committed = -month.bills
    .filter((b) => b.kind === "bill" && b.amount < 0)
    .reduce((sum, b) => sum + b.amount, 0);
  const cardSpendLine = month.bills.find((b) => b.kind === "cardSpend");
  const assumed =
    (cardSpendLine ? -cardSpendLine.amount : 0) +
    month.cardExpenseBills.reduce((sum, b) => sum - b.amount, 0);
  return { committed, assumed };
}

const ACCOUNT_GROUP_META: Record<
  string,
  { labelKey: string; icon: string; tone?: "positive" | "negative" }
> = {
  BANK: { labelKey: "accountGroups.cashOnHand", icon: "🏦" },
  CREDIT: { labelKey: "accountGroups.cards", icon: "💳", tone: "negative" },
  INVESTMENT: { labelKey: "accountGroups.investments", icon: "📈", tone: "positive" },
};

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

// Labeling every slice causes exactly the collision the small ones suffer
// from — only label slices big enough to read (>=4% of the total), and let
// the legend + tooltip carry the rest. The label is also a real click target
// (bigger and easier to hit than a thin sliver), wired to the same handler
// as clicking the slice itself.
const PIE_LABEL_MIN_PERCENT = 0.04;

// Recharts 3's Pie doesn't type activeIndex/activeShape, so growth (on
// hover OR selection) is done via a custom shape renderer instead. The
// outerRadius itself is left alone — animating a Sector's raw `d` path via
// CSS doesn't interpolate — and instead a <g> wrapper is scaled up with a
// CSS transform (a property browsers actually animate smoothly), anchored
// on the pie's own center so it grows in place rather than drifting.
function makePieShape(baseOuterRadius: number, isActive: (name: string) => boolean) {
  return (props: any) => (
    <g
      style={{
        transform: isActive(props.name) ? "scale(1.08)" : "scale(1)",
        transformOrigin: `${props.cx}px ${props.cy}px`,
        transition: "transform 180ms ease",
      }}
    >
      <Sector {...props} outerRadius={baseOuterRadius} />
    </g>
  );
}

function makePieLabel(
  onSelect: (name: string) => void,
  onHoverChange: (name: string | null) => void
) {
  return (props: any) => {
    const { cx, cy, midAngle, outerRadius, percent, name } = props;
    if (!name || percent < PIE_LABEL_MIN_PERCENT) return null;
    const RADIAN = Math.PI / 180;
    const radius = outerRadius + 14;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <text
        x={x}
        y={y}
        textAnchor={x > cx ? "start" : "end"}
        dominantBaseline="central"
        fill="var(--text-muted)"
        fontSize={12}
        style={{ cursor: "pointer" }}
        onClick={() => onSelect(name)}
        onMouseEnter={() => onHoverChange(name)}
        onMouseLeave={() => onHoverChange(null)}
      >
        {name}
      </text>
    );
  };
}

// Deliberately unboxed — the bordered squares that used to frame each pie
// were removed at the user's explicit request; the two charts are paired by
// a shared hairline divider in the section that renders them instead.
function CategoryPie(props: {
  data: { name: string; value: number }[];
  type: "CREDIT" | "DEBIT";
  drilldown: { type: "CREDIT" | "DEBIT"; category: string } | null;
  onSelect: (type: "CREDIT" | "DEBIT", category: string | null) => void;
  hoveredCategory: { type: "CREDIT" | "DEBIT"; category: string | null } | null;
  onHoverChange: (v: { type: "CREDIT" | "DEBIT"; category: string | null } | null) => void;
  categoryColorByName: Map<string, string>;
}) {
  const { t } = useTranslation("dashboard");

  function toggle(name: string) {
    props.onSelect(
      props.type,
      props.drilldown?.type === props.type && props.drilldown.category === name ? null : name
    );
  }

  function isActive(name: string) {
    return (
      (props.drilldown?.type === props.type && props.drilldown.category === name) ||
      (props.hoveredCategory?.type === props.type && props.hoveredCategory.category === name)
    );
  }

  if (props.data.length === 0) {
    return (
      <div
        style={{
          aspectRatio: "1 / 1",
          maxWidth: 420,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p className="muted">{t("chart.pieEmpty")}</p>
      </div>
    );
  }

  return (
    <div
      style={{
        aspectRatio: "1 / 1",
        maxWidth: 420,
        margin: "0 auto",
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 24, right: 24, bottom: 24, left: 24 }}>
          <Pie
            data={props.data}
            dataKey="value"
            nameKey="name"
            innerRadius={65}
            outerRadius={100}
            paddingAngle={1}
            labelLine={false}
            shape={makePieShape(100, isActive)}
            label={makePieLabel(toggle, (name) =>
              props.onHoverChange(name ? { type: props.type, category: name } : null)
            )}
            isAnimationActive={false}
            cursor="pointer"
            onMouseEnter={(entry: any) => {
              const name = entry?.name ?? entry?.payload?.name;
              if (name) props.onHoverChange({ type: props.type, category: name });
            }}
            onMouseLeave={() => props.onHoverChange(null)}
            onClick={(entry: any) => {
              const name = entry?.name ?? entry?.payload?.name;
              if (name) toggle(name);
            }}
          >
            {props.data.map((entry) => {
              const selected = isActive(entry.name);
              return (
                <Cell
                  key={entry.name}
                  fill={props.categoryColorByName.get(entry.name) ?? FALLBACK_CATEGORY_COLOR}
                  stroke={selected ? "var(--paper)" : "none"}
                  strokeWidth={selected ? 1.5 : 0}
                />
              );
            })}
          </Pie>
          <Tooltip formatter={moneyTooltip} />
          <Legend
            iconType="circle"
            iconSize={9}
            // Recharts' default legend paints each label in its series color,
            // which goes murky against the dark ink — let the circle swatch
            // carry identity (same dot pattern as the category chips
            // elsewhere) and keep the text in text tokens, brightening the
            // hovered/selected entry to mirror the slice growing.
            formatter={(value: any) => (
              <span
                style={{
                  color: isActive(String(value)) ? "var(--paper)" : "var(--text-muted)",
                  fontSize: 13,
                }}
              >
                {value}
              </span>
            )}
            onClick={(entry: any) => entry?.value && toggle(entry.value)}
            onMouseEnter={(entry: any) =>
              entry?.value && props.onHoverChange({ type: props.type, category: entry.value })
            }
            onMouseLeave={() => props.onHoverChange(null)}
            wrapperStyle={{ cursor: "pointer" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function moneyTooltip(value: any): string {
  return formatMoney(Number(value));
}

export function DashboardPage() {
  const { t } = useTranslation(["dashboard", "common"]);
  const [period, setPeriod] = useState<Period>(() => periodFor("month"));
  const [drilldown, setDrilldown] = useState<{ type: "CREDIT" | "DEBIT"; category: string } | null>(
    null
  );
  // Hover-only preview state, separate from drilldown (click) — hovering a
  // slice or its label grows it the same way selecting does, without
  // opening the transaction table underneath.
  const [hoveredCategory, setHoveredCategory] = useState<{
    type: "CREDIT" | "DEBIT";
    category: string | null;
  } | null>(null);
  const [groupDrilldown, setGroupDrilldown] = useState(false);
  const [tagId, setTagId] = useState<number | undefined>();
  const [includeCardSpend, setIncludeCardSpend] = useState(true);
  const [balanceOverTimeOpen, setBalanceOverTimeOpen] = useState(false);
  const [cardChartGrouping, setCardChartGrouping] = useState<"card" | "category">("card");
  const [hiddenTrendCategories, setHiddenTrendCategories] = useState<Set<string>>(new Set());

  function toggleTrendCategory(name: string) {
    setHiddenTrendCategories((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function changePeriod(next: Period) {
    setDrilldown(null);
    setPeriod(next);
  }

  // The Dashboard is really three different pages wearing the same
  // components: trends (a range spanning multiple months — "is my
  // financial life moving the right direction"), review (a single past or
  // current month — "did I stay in control, where exactly did it leak"),
  // and planning (a single future month — "will I be okay, what can I
  // still change"). Each mode below decides what's actually useful to show
  // instead of every component just reinterpreting itself silently.
  const dashboardMode: "trends" | "review" | "planning" = useMemo(() => {
    if (period.granularity !== "month") return "trends";
    const now = new Date();
    const isFuture =
      period.start.getFullYear() > now.getFullYear() ||
      (period.start.getFullYear() === now.getFullYear() &&
        period.start.getMonth() > now.getMonth());
    return isFuture ? "planning" : "review";
  }, [period]);

  // Mode is fully derived from the selected period, but the picker needs a
  // sensible date to jump to when the user picks a mode directly (rather
  // than arriving at one incidentally by arrowing across a month boundary).
  function switchToReview() {
    if (dashboardMode !== "review") changePeriod(periodFor("month"));
  }
  function switchToPlanning() {
    if (dashboardMode !== "planning") {
      const now = new Date();
      changePeriod(periodFor("month", new Date(now.getFullYear(), now.getMonth() + 1, 1)));
    }
  }
  function switchToTrends() {
    if (dashboardMode !== "trends") changePeriod(periodFor("year"));
  }

  // "Balance over time" is trends mode's payoff chart (is net worth
  // compounding) but noise elsewhere — default it open/closed per mode,
  // while still letting the user override within a session.
  useEffect(() => {
    setBalanceOverTimeOpen(dashboardMode === "trends");
  }, [dashboardMode]);

  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const { data: investments } = useInvestments();
  const { data: tags } = useTags();
  const { data: settings } = useSettings();
  // A real, always-3-calendar-months-back average, computed server-side
  // independent of whatever period is currently selected for viewing — the
  // client-side per-month chart data can't be trusted for this since it's
  // scoped to the dashboard's own period (as little as a single, still-
  // in-progress month), which isn't a trailing 3-month average at all.
  // 12 months out so browsing to any reasonably-near future month can still
  // look up that month's expected bills below.
  const { data: projections } = useProjections(12);
  const { data: earliestTransactionDate } = useEarliestTransactionDate();
  const allTimeStart = earliestTransactionDate?.date
    ? parseIsoDate(earliestTransactionDate.date)
    : undefined;

  const categoryColorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories ?? []) map.set(c.name, c.color);
    return map;
  }, [categories]);

  // Extend the fetch window to "now" (even if the selected period ends in
  // the past) so every month's balance can be reconstructed backward from
  // the account's current balance.
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const fetchTo = toIsoDate(new Date(Math.max(period.end.getTime(), tomorrow.getTime())));
  // Review mode's reviewVerdict/categoryAnomalies below need a trailing
  // window that predates period.start itself — without pulling those extra
  // months in here, they silently filter down to nothing (the fetch never
  // contained anything before period.start to filter from), and every
  // review-mode comparison against "usual" ends up comparing against zero.
  // Harmless for every other computation on this page: they all explicitly
  // bound themselves to period.start/period.end, so the extra earlier rows
  // just never match.
  const fetchFrom =
    dashboardMode === "review"
      ? new Date(period.start.getFullYear(), period.start.getMonth() - REVIEW_LOOKBACK_MONTHS, 1)
      : period.start;
  const { data: transactions } = useTransactions({
    from: toIsoDate(fetchFrom),
    to: fetchTo,
    tagId,
  });

  const categoryExcludesCashflow = useMemo(() => {
    const map = new Map<number, boolean>();
    for (const c of categories ?? []) map.set(c.id, c.excludes_from_cashflow);
    return map;
  }, [categories]);

  // Flag-based (not name-matched) so a category rename via CategorySelect
  // can't silently break these — see backend/API-ARCHITECTURE.md's R5.
  const categoryIsInvestmentTransfer = useMemo(() => {
    const map = new Map<number, boolean>();
    for (const c of categories ?? []) map.set(c.id, c.is_investment_transfer);
    return map;
  }, [categories]);

  const categoryIsCardBillPayment = useMemo(() => {
    const map = new Map<number, boolean>();
    for (const c of categories ?? []) map.set(c.id, c.is_card_bill_payment);
    return map;
  }, [categories]);

  const cardBillPaymentCategoryName = useMemo(
    () => (categories ?? []).find((c) => c.is_card_bill_payment)?.name ?? "Debt & Credit Card",
    [categories]
  );

  const accountTypeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of accounts ?? []) map.set(account.id, account.type);
    return map;
  }, [accounts]);

  const cardAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.type === "CREDIT"),
    [accounts]
  );

  // One card per account type (Cash on hand / Cards / Investments / ...)
  // instead of one per account, in a stable, known-types-first order.
  const accountGroups = useMemo(() => {
    const byType = new Map<string, { balance: number; currency: string }>();
    for (const a of accounts ?? []) {
      const group = byType.get(a.type) ?? { balance: 0, currency: a.currency_code };
      group.balance += a.balance;
      byType.set(a.type, group);
    }
    for (const i of investments ?? []) {
      if (i.status !== "ACTIVE") continue; // fully-withdrawn positions aren't current holdings
      const group = byType.get("INVESTMENT") ?? { balance: 0, currency: i.currency_code };
      group.balance += i.balance;
      byType.set("INVESTMENT", group);
    }
    const knownOrder = ["BANK", "CREDIT", "INVESTMENT"];
    return [...byType.entries()].sort(([typeA], [typeB]) => {
      const indexA = knownOrder.indexOf(typeA);
      const indexB = knownOrder.indexOf(typeB);
      if (indexA === -1 && indexB === -1) return typeA.localeCompare(typeB);
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });
  }, [accounts, investments]);

  const { bankBalance: currentCashBalance, investmentBalance: currentInvestmentBalance } = useMemo(
    () => computeNetWorth(accounts ?? [], investments ?? []),
    [accounts, investments]
  );

  // On credit card accounts, a charge is a positive DEBIT (increases what's
  // owed) and a payment/refund is a negative CREDIT (decreases it) — the
  // opposite convention from bank accounts. So summing t.amount directly
  // (no sign-flipping by type) already gives the correct net change.
  const allCardTx = useMemo(
    () => (transactions ?? []).filter((t) => accountTypeById.get(t.account_id) === "CREDIT"),
    [transactions, accountTypeById]
  );

  // All BANK-account transactions in the fetched window — used as-is for
  // balance reconstruction (a transfer or investment move still really
  // changes the account's balance, even though it isn't "income" or "spend").
  const allBankTx = useMemo(
    () => (transactions ?? []).filter((t) => accountTypeById.get(t.account_id) === "BANK"),
    [transactions, accountTypeById]
  );

  // Same set, minus Transfers/Savings — this is "real" cash flow, used for
  // the Money In / Money Out headline totals and the In/Out bars so a
  // transfer between your own accounts (or a move into savings) doesn't
  // inflate either number.
  const cashflowBankTx = useMemo(
    () => allBankTx.filter((t) => !categoryExcludesCashflow.get(t.category_id ?? -1)),
    [allBankTx, categoryExcludesCashflow]
  );

  const inPeriodCashflowTx = useMemo(
    () =>
      cashflowBankTx.filter((t) => {
        const date = new Date(t.date);
        return date >= period.start && date < period.end;
      }),
    [cashflowBankTx, period]
  );

  const totalIn = useMemo(
    () =>
      inPeriodCashflowTx.filter((t) => t.type === "CREDIT").reduce((sum, t) => sum + t.amount, 0),
    [inPeriodCashflowTx]
  );

  const totalOut = useMemo(
    () =>
      inPeriodCashflowTx
        .filter((t) => t.type === "DEBIT")
        .reduce((sum, t) => sum + Math.abs(t.amount), 0),
    [inPeriodCashflowTx]
  );

  const chartData = useMemo(() => {
    const rows = monthsInPeriod(period).map((month) => {
      const monthCashflowTx = cashflowBankTx.filter((t) => {
        const date = new Date(t.date);
        return date >= month.start && date < month.end;
      });
      const inAmount = monthCashflowTx
        .filter((t) => t.type === "CREDIT")
        .reduce((sum, t) => sum + t.amount, 0);
      const outAmount = monthCashflowTx
        .filter((t) => t.type === "DEBIT")
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      // Walk the current cash balance backward through every BANK
      // transaction (including transfers/savings) that happened after this
      // month ended.
      const netAfterMonthEnd = allBankTx
        .filter((t) => new Date(t.date) >= month.end)
        .reduce((sum, t) => sum + (t.type === "CREDIT" ? t.amount : -Math.abs(t.amount)), 0);
      const cashBalance = currentCashBalance - netAfterMonthEnd;

      // Same backward walk for investment holdings, using only
      // is_investment_transfer-flagged moves: a DEBIT (money leaving the
      // bank into the investment) increases the investment; a CREDIT
      // (a redemption) decreases it. This doesn't account for accrued
      // yield between then and now, so past months are a slight
      // underestimate — Pluggy only gives us the investment's current
      // value, not a historical time series.
      const investmentNetAfterMonthEnd = allBankTx
        .filter(
          (t) =>
            categoryIsInvestmentTransfer.get(t.category_id ?? -1) && new Date(t.date) >= month.end
        )
        .reduce((sum, t) => sum + (t.type === "DEBIT" ? Math.abs(t.amount) : -t.amount), 0);
      const investmentBalance = currentInvestmentBalance - investmentNetAfterMonthEnd;

      // For a future month there's no real bank cash flow to show yet — but
      // there IS a real expectation: confirmed income bills, debts' own
      // known schedule, and card spend, all already computed by the same
      // engine the Projections page uses. Shown as a separate faded
      // segment rather than pretending it's already-happened cash flow.
      // Two confidence tiers, not one flat "expected" — committed (real
      // recurring bills, debts' own schedule, interest) vs assumed (the
      // card-spend goal/average, and any future card charge with no
      // transaction history yet). Income has no "assumed" tier — every
      // income line is a confirmed bill, so it's all committed.
      const isFuture = month.start > new Date();
      const projectedMonth = isFuture ? findProjectedMonth(projections, month.start) : undefined;
      const { committed, assumed, income: expectedIn } = expectedBreakdown(projectedMonth);
      const expectedOutCommitted = sumIncomeExpense(committed).expense;
      const expectedOutAssumed = sumIncomeExpense(assumed).expense;

      return {
        label: month.label,
        start: month.start,
        balance: cashBalance + investmentBalance,
        in: inAmount,
        out: outAmount,
        expectedIn,
        expectedOutCommitted,
        expectedOutAssumed,
      };
    });

    // Trends mode's whole point is separating real direction from
    // month-to-month noise — a rolling average is what lets "is this
    // trending down" survive one unusually expensive or light month. For a
    // future month there's no real in/out yet (both 0), so leaving expected
    // amounts out here would drag the average toward zero right where the
    // projection has something to say — effectiveNet folds both in, and
    // collapses to the plain real net for any past/current month (their
    // expected fields are already 0).
    const effectiveNet = (r: (typeof rows)[number]) =>
      r.in - r.out + r.expectedIn - r.expectedOutCommitted - r.expectedOutAssumed;
    return rows.map((row, i) => {
      const window = rows.slice(Math.max(0, i - 2), i + 1);
      const netRollingAvg = window.reduce((sum, r) => sum + effectiveNet(r), 0) / window.length;
      return { ...row, netRollingAvg };
    });
  }, [
    period,
    cashflowBankTx,
    allBankTx,
    currentCashBalance,
    currentInvestmentBalance,
    projections,
    categoryIsInvestmentTransfer,
  ]);

  // How much was actually charged on each card each month — a spend rate,
  // distinct from the running balance above (which includes carried debt).
  // Only DEBIT (positive) rows count as spend; CREDIT rows are
  // payments/refunds, not purchases.
  const cardSpendChartData = useMemo(() => {
    return monthsInPeriod(period).map((month) => {
      const row: Record<string, string | number | Date> = {
        label: month.label,
        start: month.start,
      };
      for (const card of cardAccounts) {
        row[card.name] = allCardTx
          .filter(
            (t) =>
              t.account_id === card.id &&
              t.type === "DEBIT" &&
              new Date(t.date) >= month.start &&
              new Date(t.date) < month.end
          )
          .reduce((sum, t) => sum + t.amount, 0);
      }
      return row;
    });
  }, [period, cardAccounts, allCardTx]);

  // For a future month, real card data is whatever's already
  // pre-scheduled (e.g. an Airbnb installment already dated and committed)
  // — that's not a projection, it's a real known fact, and stays at full
  // opacity like any other bar. What IS a projection is "this recurring
  // bill will keep recurring" — so each future month gets that added as its
  // own separate, reduced-opacity segment, reusing the exact bill-kind
  // lines the Projections page itself already computes (same cadence/
  // recurrence-bounds logic, not reimplemented here) rather than showing
  // real data go quiet just because the next occurrence hasn't posted yet.
  const cardSpendChartDataWithExpectedBills = useMemo(() => {
    const now = new Date();
    // computeProjection only generates months strictly after "now" — the
    // current, in-progress month never appears in projections.months, so it
    // needs its own handling: real spend-so-far plus however much of the
    // card-spend goal/average hasn't been charged yet, rather than either a
    // full future projection or nothing. Without this, a month 9 days in
    // reads as a cliff-drop next to a full prior month, which looks like a
    // bug rather than "the month isn't over."
    const cardGoal = settings?.cardSpendGoal ?? projections?.cardSpendActualAverage ?? 0;
    return cardSpendChartData.map((row) => {
      const start = row.start as Date;
      const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      if (start > now) {
        const { committed, assumed } = expectedCardCharges(findProjectedMonth(projections, start));
        return { ...row, expectedBillsCommitted: committed, expectedBillsAssumed: assumed };
      }
      if (monthEnd > now) {
        const spentSoFar = cardAccounts.reduce((sum, card) => sum + Number(row[card.name] ?? 0), 0);
        const remainingAssumed = Math.max(0, cardGoal - spentSoFar);
        return { ...row, expectedBillsCommitted: 0, expectedBillsAssumed: remainingAssumed };
      }
      return { ...row, expectedBillsCommitted: 0, expectedBillsAssumed: 0 };
    });
  }, [cardSpendChartData, projections, settings, cardAccounts]);

  // Same per-month bucketing, but grouped by spend category instead of by
  // card — a different lens on the same underlying card transactions.
  const cardCategoryNames = useMemo(() => {
    const names = new Set<string>();
    for (const t of allCardTx) {
      if (t.type !== "DEBIT") continue;
      names.add(t.category_name ?? "Uncategorized");
    }
    return [...names].sort();
  }, [allCardTx]);

  const cardCategorySpendByMonth = useMemo(() => {
    return monthsInPeriod(period).map((month) => {
      const row: Record<string, string | number | Date> = {
        label: month.label,
        start: month.start,
      };
      for (const name of cardCategoryNames) row[name] = 0;
      for (const t of allCardTx) {
        if (t.type !== "DEBIT") continue;
        const date = new Date(t.date);
        if (date < month.start || date >= month.end) continue;
        const name = t.category_name ?? "Uncategorized";
        row[name] = Number(row[name] ?? 0) + t.amount;
      }
      return row;
    });
  }, [period, cardCategoryNames, allCardTx]);

  const TOP_CATEGORY_COUNT = 6;

  // Trends mode's answer to "is spending creeping up in some category" — a
  // static pie can't show that, only a trend over time can. Same merge rule
  // as categoryBreakdown (bank spend + card spend, minus the bank-side card
  // bill payment to avoid double-counting), just bucketed by month and
  // narrowed to whichever categories actually dominate the period.
  const topCategoriesOverTime = useMemo(() => {
    const months = monthsInPeriod(period);
    const totalsByCategory = new Map<string, number>();
    // Per-month, per-category totals first, top names decided second — a
    // category only earns a row entry once we know it's actually a top
    // one, and every top category then gets an explicit 0 (not a missing
    // key) for months it had no spend in. A missing key here would leave
    // that month's value undefined, which the line's dot renderer doesn't
    // guard against — recharts still calls it, at an invalid position.
    const perMonthTotals = months.map(() => new Map<string, number>());
    const addSpend = (date: Date, name: string, amount: number) => {
      const monthIndex = months.findIndex((m) => date >= m.start && date < m.end);
      if (monthIndex === -1) return;
      const perMonth = perMonthTotals[monthIndex]!;
      perMonth.set(name, (perMonth.get(name) ?? 0) + amount);
      totalsByCategory.set(name, (totalsByCategory.get(name) ?? 0) + amount);
    };
    for (const t of cashflowBankTx) {
      if (t.type !== "DEBIT") continue;
      if (includeCardSpend && categoryIsCardBillPayment.get(t.category_id ?? -1)) continue;
      addSpend(new Date(t.date), t.category_name ?? "Uncategorized", Math.abs(t.amount));
    }
    if (includeCardSpend) {
      for (const t of allCardTx) {
        if (t.type !== "DEBIT") continue;
        addSpend(new Date(t.date), t.category_name ?? "Uncategorized", t.amount);
      }
    }

    // Real transactions only exist for months that have already happened —
    // without this, every future month in the period would flatline to
    // zero for every category. Confirmed bills already carry a category, so
    // a future month's expected spend can be attributed the same way — via
    // each line's own server-attributed category_name (see
    // backend/API-ARCHITECTURE.md's R3), no client-side id cross-reference
    // needed at all anymore.
    const now = new Date();
    for (const month of months) {
      if (month.start <= now) continue;
      const projectedMonth = findProjectedMonth(projections, month.start);
      if (!projectedMonth) continue;
      // A debt line without a linked bill has no real category to attribute
      // it to — bucketed as "Debt Repayment" (matching planningCategoryBreakdown's
      // convention below) rather than silently dropped.
      const expenseLines = [
        ...projectedMonth.bills
          .filter((l) => (l.kind === "bill" || l.kind === "debt") && l.amount < 0)
          .map((l) => ({
            name: l.category_name ?? (l.kind === "debt" ? "Debt Repayment" : "Uncategorized"),
            amount: l.amount,
          })),
        ...projectedMonth.cardExpenseBills.map((l) => ({
          name: l.category_name ?? "Uncategorized",
          amount: l.amount,
        })),
      ];
      for (const line of expenseLines) {
        addSpend(month.start, line.name, -line.amount);
      }
    }

    const topNames = [...totalsByCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_CATEGORY_COUNT)
      .map(([name]) => name);

    const monthly = months.map((month, i) => {
      const row: Record<string, string | number | Date> = {
        label: month.label,
        start: month.start,
      };
      for (const name of topNames) row[name] = perMonthTotals[i]!.get(name) ?? 0;
      return row;
    });

    return { monthly, topNames };
  }, [period, cashflowBankTx, allCardTx, includeCardSpend, projections, categoryIsCardBillPayment]);

  function handleBarClick(data: any) {
    const start = data?.payload?.start ?? data?.start;
    if (start) changePeriod(periodFor("month", new Date(start)));
  }

  // Browsing a future month on the Dashboard only ever shows real (usually
  // sparse — a pre-scheduled installment or two) transaction data. Planning
  // mode's job is answering "will I be okay, what can I still change" —
  // a headline projected net, committed vs assumed expenses (two different
  // confidence tiers, not one flat "future"), and how much discretionary
  // card room is left after known commitments.
  const planningData = useMemo(() => {
    if (dashboardMode !== "planning") return null;
    const month = findProjectedMonth(projections, period.start);
    if (!month) return null;
    const breakdown = expectedBreakdown(month);
    const cardSpendLine = month.bills.find((b) => b.kind === "cardSpend");
    const cardGoal = cardSpendLine ? Math.abs(cardSpendLine.amount) : 0;
    const knownCardCharges = month.cardExpenseBills.reduce((sum, b) => sum - b.amount, 0);
    return {
      income: breakdown.income,
      expense: breakdown.expense,
      net: breakdown.income - breakdown.expense,
      incomeLines: breakdown.lines.filter((l) => l.amount >= 0),
      committedExpenseLines: breakdown.committed.filter((l) => l.amount < 0),
      assumedExpenseLines: breakdown.assumed,
      cardGoal,
      knownCardCharges,
      cardRoomLeft: cardGoal - knownCardCharges,
    };
  }, [dashboardMode, period, projections]);

  const planningFlowData = useMemo(() => {
    if (!planningData) return [];
    return [
      { name: t("planning.flowLabels.expectedIn"), income: planningData.income },
      {
        name: t("planning.flowLabels.expectedOut"),
        committed: sumIncomeExpense(planningData.committedExpenseLines).expense,
        assumed: sumIncomeExpense(planningData.assumedExpenseLines).expense,
      },
    ];
  }, [planningData, t]);

  // Every line already carries its own server-attributed category_name (see
  // backend/API-ARCHITECTURE.md's R3) — no more id cross-reference needed.
  // Two kinds of expense line here were never going to resolve to a real
  // bill category, since they aren't bills at all: the cardSpend goal/
  // average is a synthetic aggregate (kind "cardSpend"), and a debt's own
  // repayment line with no linked bill (kind "debt", category_name null).
  // Bucket them into the same categories those amounts already show up under
  // elsewhere in the app (the card bill payment is whichever category is
  // flagged is_card_bill_payment; a debt repayment gets its own "Debt
  // Repayment" category).
  const planningCategoryBreakdown = useMemo(() => {
    if (!planningData) return [];
    const categoryFor = (line: ExpectedLine) => {
      if (line.kind === "cardSpend") return cardBillPaymentCategoryName;
      if (line.category_name) return line.category_name;
      if (line.kind === "debt") return "Debt Repayment";
      return "Uncategorized";
    };
    const totals = new Map<string, number>();
    for (const line of [
      ...planningData.committedExpenseLines,
      ...planningData.assumedExpenseLines,
    ]) {
      const name = categoryFor(line);
      totals.set(name, (totals.get(name) ?? 0) + Math.abs(line.amount));
    }
    return [...totals.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [planningData, cardBillPaymentCategoryName]);

  // Net per month goes through expectedBreakdown rather than reading
  // month.net directly — month.net deliberately leaves out cardExpenseBills
  // (see expectedBreakdown's comment), so using it here would make the
  // viewed month's bar disagree with the "Projected net" headline above it.
  const planningOutlookData = useMemo(() => {
    if (dashboardMode !== "planning" || !projections) return [];
    const viewedLabel = `${period.start.getFullYear()}-${String(period.start.getMonth() + 1).padStart(2, "0")}`;
    return projections.months.map((m) => {
      const { income, expense } = expectedBreakdown(m);
      const [year, month] = m.label.split("-").map(Number);
      return {
        label: m.label,
        start: new Date(year, month - 1, 1),
        net: income - expense,
        isViewed: m.label === viewedLabel,
      };
    });
  }, [dashboardMode, projections, period]);

  // Transfers between your own accounts and investment moves (Savings &
  // Investments) are excluded everywhere on this page, not just the
  // headline totals — that money never left your net worth, so it isn't
  // "spend" or "income" in the category breakdowns either.
  //
  // Card spending is folded in here too, so this reflects where money
  // actually went regardless of payment method — not just bank-account
  // debits. The "Debt & Credit Card" category is excluded on the bank side
  // specifically, since that's the aggregate bill payment to the card
  // issuer; counting it as well as the individual card purchases behind it
  // would double it up.
  const categoryBreakdown = useCallback(
    (type: "CREDIT" | "DEBIT") => {
      const totals = new Map<string, number>();
      for (const t of cashflowBankTx) {
        if (t.type !== type) continue;
        if (includeCardSpend && categoryIsCardBillPayment.get(t.category_id ?? -1)) continue;
        const date = new Date(t.date);
        if (date < period.start || date >= period.end) continue;
        const name = t.category_name ?? "Uncategorized";
        totals.set(name, (totals.get(name) ?? 0) + Math.abs(t.amount));
      }
      if (includeCardSpend) {
        for (const t of allCardTx) {
          if (t.type !== type) continue;
          const date = new Date(t.date);
          if (date < period.start || date >= period.end) continue;
          const name = t.category_name ?? "Uncategorized";
          totals.set(name, (totals.get(name) ?? 0) + Math.abs(t.amount));
        }
      }
      return [...totals.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);
    },
    [cashflowBankTx, allCardTx, period, includeCardSpend, categoryIsCardBillPayment]
  );

  const inByCategory = useMemo(() => categoryBreakdown("CREDIT"), [categoryBreakdown]);
  const outByCategory = useMemo(() => categoryBreakdown("DEBIT"), [categoryBreakdown]);

  // Review mode's whole point is accountability, which requires a baseline
  // to be accountable against — "did I stay in control" is meaningless
  // without "compared to what." Trailing 3 calendar months, excluding the
  // month being reviewed itself.
  const reviewVerdict = useMemo(() => {
    if (dashboardMode !== "review") return null;
    const netThisMonth = totalIn - totalOut;
    const cardSpendThisMonth = cardAccounts.reduce(
      (sum, card) => sum + Number(cardSpendChartData[0]?.[card.name] ?? 0),
      0
    );

    const trailingStart = new Date(
      period.start.getFullYear(),
      period.start.getMonth() - REVIEW_LOOKBACK_MONTHS,
      1
    );
    const inTrailingWindow = (t: { date: string }) => {
      const d = new Date(t.date);
      return d >= trailingStart && d < period.start;
    };
    const trailingTx = cashflowBankTx.filter(inTrailingWindow);
    const trailingIn = trailingTx
      .filter((t) => t.type === "CREDIT")
      .reduce((s, t) => s + t.amount, 0);
    const trailingOut = trailingTx
      .filter((t) => t.type === "DEBIT")
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    const netTrailingAvg = (trailingIn - trailingOut) / REVIEW_LOOKBACK_MONTHS;

    // With no explicit goal the recent actual average stands in as the
    // baseline — a fair "your usual", but it shouldn't be labeled a "goal"
    // the user never set.
    const cardGoalIsExplicit = settings?.cardSpendGoal != null;
    const cardGoal = settings?.cardSpendGoal ?? projections?.cardSpendActualAverage ?? null;

    return { netThisMonth, cardSpendThisMonth, netTrailingAvg, cardGoal, cardGoalIsExplicit };
  }, [
    dashboardMode,
    totalIn,
    totalOut,
    cardAccounts,
    cardSpendChartData,
    period,
    cashflowBankTx,
    settings,
    projections,
  ]);

  // "Where exactly did it leak" — categories spending noticeably more than
  // their own recent normal, not just the biggest slice (a big-but-steady
  // category isn't where control was lost; a spike is).
  const categoryAnomalies = useMemo(() => {
    if (dashboardMode !== "review") return [];
    const trailingStart = new Date(
      period.start.getFullYear(),
      period.start.getMonth() - REVIEW_LOOKBACK_MONTHS,
      1
    );
    const trailingTotals = new Map<string, number>();
    const addTrailing = (date: Date, name: string, amount: number) => {
      if (date < trailingStart || date >= period.start) return;
      trailingTotals.set(name, (trailingTotals.get(name) ?? 0) + amount);
    };
    for (const t of cashflowBankTx) {
      if (t.type !== "DEBIT") continue;
      if (includeCardSpend && categoryIsCardBillPayment.get(t.category_id ?? -1)) continue;
      addTrailing(new Date(t.date), t.category_name ?? "Uncategorized", Math.abs(t.amount));
    }
    if (includeCardSpend) {
      for (const t of allCardTx) {
        if (t.type !== "DEBIT") continue;
        addTrailing(new Date(t.date), t.category_name ?? "Uncategorized", t.amount);
      }
    }

    const ANOMALY_MIN_TRAILING_AVG = 10; // filters out noise from categories with barely any history
    const ANOMALY_THRESHOLD_PERCENT = 0.25;

    return outByCategory
      .map((cat) => {
        const trailingAvg = (trailingTotals.get(cat.name) ?? 0) / REVIEW_LOOKBACK_MONTHS;
        return {
          ...cat,
          trailingAvg,
          pctAbove: trailingAvg > 0 ? (cat.value - trailingAvg) / trailingAvg : Infinity,
        };
      })
      .filter(
        (cat) =>
          cat.trailingAvg >= ANOMALY_MIN_TRAILING_AVG && cat.pctAbove > ANOMALY_THRESHOLD_PERCENT
      )
      .sort((a, b) => b.pctAbove - a.pctAbove)
      .slice(0, 5);
  }, [
    dashboardMode,
    period,
    cashflowBankTx,
    allCardTx,
    includeCardSpend,
    outByCategory,
    categoryIsCardBillPayment,
  ]);

  const anomalyOverspend = categoryAnomalies.reduce((sum, c) => sum + (c.value - c.trailingAvg), 0);

  // Reviewing the current month means holding a partial month against full
  // past ones — "behind pace" is the expected state for most of it, and a
  // verdict that reads as a fact needs that caveat stated, not implied.
  const reviewDaysLeft = useMemo(() => {
    if (dashboardMode !== "review") return null;
    const now = new Date();
    if (now < period.start || now >= period.end) return null;
    return Math.ceil((period.end.getTime() - now.getTime()) / 86_400_000);
  }, [dashboardMode, period]);

  // Category spikes say which bucket leaked; this says which specific
  // purchases — a month can leak through one big hit that never registers
  // as an anomaly because its category was already large. Same inclusion
  // rule as categoryBreakdown/drilldownTx so the numbers agree with the
  // pies below.
  const largestExpenses = useMemo(() => {
    if (dashboardMode !== "review") return null;
    const inRange = (t: { date: string }) => {
      const date = new Date(t.date);
      return date >= period.start && date < period.end;
    };
    const bank = cashflowBankTx.filter(
      (t) =>
        t.type === "DEBIT" &&
        (!includeCardSpend || !categoryIsCardBillPayment.get(t.category_id ?? -1)) &&
        inRange(t)
    );
    const card = includeCardSpend ? allCardTx.filter((t) => t.type === "DEBIT" && inRange(t)) : [];
    const top = [...bank, ...card]
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 5);
    const outTotal = outByCategory.reduce((sum, c) => sum + c.value, 0);
    const topTotal = top.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    return { top, share: outTotal > 0 ? topTotal / outTotal : 0 };
  }, [
    dashboardMode,
    period,
    cashflowBankTx,
    allCardTx,
    includeCardSpend,
    outByCategory,
    categoryIsCardBillPayment,
  ]);

  const drilldownTx = useMemo(() => {
    if (!drilldown) return [];
    const inRange = (t: { date: string }) => {
      const date = new Date(t.date);
      return date >= period.start && date < period.end;
    };
    const bankMatches = cashflowBankTx.filter(
      (t) =>
        t.type === drilldown.type &&
        (!includeCardSpend || !categoryIsCardBillPayment.get(t.category_id ?? -1)) &&
        inRange(t) &&
        (t.category_name ?? "Uncategorized") === drilldown.category
    );
    const cardMatches = includeCardSpend
      ? allCardTx.filter(
          (t) =>
            t.type === drilldown.type &&
            inRange(t) &&
            (t.category_name ?? "Uncategorized") === drilldown.category
        )
      : [];
    return [...bankMatches, ...cardMatches].sort((a, b) => b.date.localeCompare(a.date));
  }, [cashflowBankTx, allCardTx, period, drilldown, includeCardSpend, categoryIsCardBillPayment]);

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div className="toggle-group">
            <button
              type="button"
              className={dashboardMode === "review" ? "active" : undefined}
              onClick={switchToReview}
            >
              {t("modes.review")}
            </button>
            <button
              type="button"
              className={dashboardMode === "trends" ? "active" : undefined}
              onClick={switchToTrends}
            >
              {t("modes.trends")}
            </button>
            <button
              type="button"
              className={dashboardMode === "planning" ? "active" : undefined}
              onClick={switchToPlanning}
            >
              {t("modes.plan")}
            </button>
          </div>
          {dashboardMode === "trends" ? (
            <PeriodPicker
              value={period}
              onChange={changePeriod}
              granularities={["quarter", "semester", "year", "custom"]}
              allTimeStart={allTimeStart}
            />
          ) : (
            <PeriodPicker value={period} onChange={changePeriod} showGranularityPicker={false} />
          )}
        </div>
        {tags && tags.length > 0 && (
          <label style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            {t("filterByTag")}
            <select
              value={tagId ?? ""}
              onChange={(e) => setTagId(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">{t("allTransactions")}</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        {accountGroups.map(([type, group]) => {
          const meta = ACCOUNT_GROUP_META[type];
          const label = meta ? t(meta.labelKey) : titleCase(type);
          const icon = meta?.icon ?? "💰";
          // The full card balance includes every already-committed future
          // installment (e.g. an Airbnb stay split 6x), not just what's
          // actually due next — break that out so "total owed" and "due next
          // month" aren't conflated into one number.
          let caption: string | undefined;
          const today = new Date();
          const nextMonth = findProjectedMonth(
            projections,
            new Date(today.getFullYear(), today.getMonth() + 1, 1)
          );
          if (type === "CREDIT" && nextMonth) {
            const dueNextLine = nextMonth.bills.find((b) => b.kind === "cardSpend");
            const dueNext = dueNextLine ? Math.abs(dueNextLine.amount) : undefined;
            if (dueNext != null) {
              const futureInstallments = group.balance - dueNext;
              caption =
                futureInstallments > 0.01
                  ? t("accountGroups.dueNextMonthWithFuture", {
                      dueNext: formatMoney(dueNext),
                      future: formatMoney(futureInstallments),
                    })
                  : t("accountGroups.dueNextMonth", { dueNext: formatMoney(dueNext) });
            }
          }
          return (
            <SummaryCard
              key={type}
              label={`${icon} ${label}`}
              value={formatMoney(group.balance, group.currency)}
              tone={meta?.tone}
              caption={caption}
            />
          );
        })}
        {dashboardMode === "planning" && planningData ? (
          <>
            <SummaryCard
              label={t("summary.expectedIn")}
              value={formatMoney(planningData.income)}
              tone="positive"
              caption={t("summary.expectedInCaption")}
            />
            <SummaryCard
              label={t("summary.expectedOut")}
              value={formatMoney(planningData.expense)}
              tone="negative"
              caption={t("summary.expectedOutCaption")}
            />
          </>
        ) : (
          <>
            <SummaryCard
              label={t("summary.moneyIn")}
              value={formatMoney(totalIn)}
              tone="positive"
            />
            <SummaryCard
              label={t("summary.moneyOut")}
              value={formatMoney(totalOut)}
              tone="negative"
            />
          </>
        )}
      </div>

      {reviewVerdict && (
        <div className="card">
          <h2>{t("review.heading", { period: period.label })}</h2>
          {reviewDaysLeft != null && (
            <p className="muted">{t("review.daysLeft", { count: reviewDaysLeft })}</p>
          )}
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div
              className={`summary-card ${
                reviewVerdict.netThisMonth >= reviewVerdict.netTrailingAvg ? "good" : "bad"
              }`}
            >
              <div className="label">{t("review.netVsUsual")}</div>
              <div className="value">
                {reviewVerdict.netThisMonth >= reviewVerdict.netTrailingAvg ? "▲" : "▼"}{" "}
                {formatMoney(Math.abs(reviewVerdict.netThisMonth - reviewVerdict.netTrailingAvg))}
              </div>
              <div className="caption">
                {t("review.netVsUsualCaption", {
                  net: formatMoney(reviewVerdict.netThisMonth),
                  avg: formatMoney(reviewVerdict.netTrailingAvg),
                  months: REVIEW_LOOKBACK_MONTHS,
                  verdict:
                    reviewVerdict.netThisMonth >= reviewVerdict.netTrailingAvg
                      ? t("review.aheadOfUsualPace")
                      : t("review.behindUsualPace"),
                })}
              </div>
            </div>
            {reviewVerdict.cardGoal != null && (
              <div
                className={`summary-card ${
                  reviewVerdict.cardSpendThisMonth <= reviewVerdict.cardGoal ? "good" : "bad"
                }`}
              >
                <div className="label">
                  {reviewVerdict.cardGoalIsExplicit
                    ? t("review.cardSpendVsGoal")
                    : t("review.cardSpendVsUsual")}
                </div>
                <div className="value">
                  {reviewVerdict.cardSpendThisMonth <= reviewVerdict.cardGoal
                    ? t("review.underByAmount", {
                        amount: formatMoney(
                          Math.abs(reviewVerdict.cardGoal - reviewVerdict.cardSpendThisMonth)
                        ),
                      })
                    : t("review.overByAmount", {
                        amount: formatMoney(
                          Math.abs(reviewVerdict.cardGoal - reviewVerdict.cardSpendThisMonth)
                        ),
                      })}
                </div>
                <div className="caption">
                  {t("review.cardSpendCaption", {
                    spent: formatMoney(reviewVerdict.cardSpendThisMonth),
                    goalPhrase: reviewVerdict.cardGoalIsExplicit
                      ? t("review.yourGoal", { amount: formatMoney(reviewVerdict.cardGoal) })
                      : t("review.yourUsualNoGoal", {
                          amount: formatMoney(reviewVerdict.cardGoal),
                        }),
                  })}
                </div>
              </div>
            )}
          </div>
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 24,
              marginTop: 20,
            }}
          >
            <div>
              <h3>{t("review.whereItLeaked")}</h3>
              {categoryAnomalies.length > 0 ? (
                <>
                  <p className="muted">
                    {t("review.anomaliesIntro", {
                      months: REVIEW_LOOKBACK_MONTHS,
                      amount: formatMoney(anomalyOverspend),
                    })}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {categoryAnomalies.map((cat) => {
                      const selected =
                        drilldown?.type === "DEBIT" && drilldown.category === cat.name;
                      return (
                        <button
                          key={cat.name}
                          type="button"
                          className="secondary"
                          onClick={() =>
                            setDrilldown(selected ? null : { type: "DEBIT", category: cat.name })
                          }
                          style={{
                            width: "100%",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: 12,
                            background: selected ? "var(--ink-raised-hover)" : undefined,
                            borderColor: selected ? "var(--text-muted)" : undefined,
                          }}
                        >
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 8,
                              minWidth: 0,
                            }}
                          >
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: "50%",
                                background:
                                  categoryColorByName.get(cat.name) ?? FALLBACK_CATEGORY_COLOR,
                                flexShrink: 0,
                              }}
                            />
                            <span style={{ color: "var(--paper)", fontWeight: 600 }}>
                              {cat.name}
                            </span>
                            <span className="muted" style={{ fontWeight: 400 }}>
                              {t("review.vsUsualPerMonth", {
                                value: formatMoney(cat.value),
                                avg: formatMoney(cat.trailingAvg),
                              })}
                            </span>
                          </span>
                          <span
                            className="money"
                            style={{ color: "var(--danger)", whiteSpace: "nowrap" }}
                          >
                            {t("review.aboveUsual", {
                              diff: formatMoney(cat.value - cat.trailingAvg),
                              pct: Math.round(cat.pctAbove * 100),
                            })}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="muted">
                  {t("review.noAnomalies", { months: REVIEW_LOOKBACK_MONTHS })}
                </p>
              )}
            </div>
            {largestExpenses && largestExpenses.top.length > 0 && (
              <div>
                <h3>{t("review.biggestHits")}</h3>
                <p className="muted">
                  {t("review.biggestHitsIntro", {
                    count: largestExpenses.top.length,
                    pct: Math.round(largestExpenses.share * 100),
                  })}
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>{t("table.day")}</th>
                      <th>{t("common:table.description")}</th>
                      <th>{t("common:table.category")}</th>
                      <th>{t("common:table.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {largestExpenses.top.map((t) => (
                      <tr key={t.id}>
                        <td className="money" style={{ color: "var(--text-muted)" }}>
                          {String(new Date(t.date).getDate()).padStart(2, "0")}
                        </td>
                        <td>{t.description}</td>
                        <td>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                background:
                                  categoryColorByName.get(t.category_name ?? "Uncategorized") ??
                                  FALLBACK_CATEGORY_COLOR,
                                flexShrink: 0,
                              }}
                            />
                            {t.category_name ?? "Uncategorized"}
                          </span>
                        </td>
                        <td className="money shortfall">{formatMoney(Math.abs(t.amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {planningData && (
        <div className="card">
          <h2>{t("planning.heading", { period: period.label })}</h2>
          <p className="muted">{t("planning.intro")}</p>
          <div
            className={`summary-card ${planningData.net < 0 ? "bad" : "good"}`}
            style={{ marginBottom: 16 }}
          >
            <div className="label">{t("planning.projectedNet")}</div>
            <div className="value">
              {planningData.net >= 0 ? "+" : ""}
              {formatMoney(planningData.net)}
            </div>
            <div className="caption">
              {t("planning.projectedNetCaption", {
                income: formatMoney(planningData.income),
                expense: formatMoney(planningData.expense),
              })}
            </div>
          </div>
          {planningData.cardGoal > 0 && (
            <div
              className={`summary-card${planningData.cardRoomLeft < 0 ? " bad" : ""}`}
              style={{ marginBottom: 16 }}
            >
              <div className="label">{t("planning.cardRoomLeft")}</div>
              <div className="value">{formatMoney(planningData.cardRoomLeft)}</div>
              <div className="caption">
                {t("planning.cardRoomLeftCaption", {
                  goal: formatMoney(planningData.cardGoal),
                  known: formatMoney(planningData.knownCardCharges),
                })}
              </div>
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <h3>{t("planning.inOutGlance")}</h3>
            <p className="muted">{t("planning.inOutGlanceIntro")}</p>
            <div className="chart-container" style={{ height: 150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={planningFlowData} layout="vertical" margin={{ right: 24 }}>
                  <XAxis type="number" stroke="var(--text-muted)" />
                  <YAxis type="category" dataKey="name" stroke="var(--text-muted)" width={110} />
                  <Tooltip formatter={moneyTooltip} />
                  <Legend />
                  <Bar
                    dataKey="income"
                    name={t("planning.flowLabels.expectedIn")}
                    stackId="flow"
                    fill="var(--accent)"
                    fillOpacity={0.4}
                  />
                  <Bar
                    dataKey="committed"
                    name={t("planning.flowLabels.committedOut")}
                    stackId="flow"
                    fill="var(--danger)"
                    fillOpacity={0.6}
                  />
                  <Bar
                    dataKey="assumed"
                    name={t("planning.flowLabels.assumedOut")}
                    stackId="flow"
                    fill="var(--danger)"
                    fillOpacity={0.25}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          {planningCategoryBreakdown.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h3>{t("planning.expectedByCategory")}</h3>
              <p className="muted">{t("planning.expectedByCategoryIntro")}</p>
              <div
                className="chart-container"
                style={{ height: Math.max(120, planningCategoryBreakdown.length * 32) }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={planningCategoryBreakdown}
                    layout="vertical"
                    margin={{ right: 24 }}
                  >
                    <XAxis type="number" stroke="var(--text-muted)" />
                    <YAxis type="category" dataKey="name" stroke="var(--text-muted)" width={130} />
                    <Tooltip formatter={moneyTooltip} />
                    <Bar dataKey="value" name={t("planning.expectedBarName")}>
                      {planningCategoryBreakdown.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={categoryColorByName.get(entry.name) ?? FALLBACK_CATEGORY_COLOR}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
            <div>
              <h3>{t("planning.expectedIncome")}</h3>
              {planningData.incomeLines.length === 0 ? (
                <p className="muted">{t("planning.none")}</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>{t("table.source")}</th>
                      <th>{t("common:table.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planningData.incomeLines.map((b) => (
                      <tr key={b.id}>
                        <td>{b.name}</td>
                        <td className="money" style={{ color: "var(--accent)" }}>
                          +{formatMoney(b.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <h3 title={t("planning.committedExpensesTooltip")}>
                {t("planning.committedExpenses")}
              </h3>
              {planningData.committedExpenseLines.length === 0 ? (
                <p className="muted">{t("planning.none")}</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>{t("table.bill")}</th>
                      <th>{t("common:table.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planningData.committedExpenseLines.map((b) => (
                      <tr key={b.id}>
                        <td>{b.name}</td>
                        <td className="money shortfall">{formatMoney(b.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <h3 title={t("planning.assumedExpensesTooltip")}>{t("planning.assumedExpenses")}</h3>
              {planningData.assumedExpenseLines.length === 0 ? (
                <p className="muted">{t("planning.none")}</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>{t("table.bill")}</th>
                      <th>{t("common:table.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planningData.assumedExpenseLines.map((b) => (
                      <tr key={b.id}>
                        <td style={{ opacity: 0.7 }}>{b.name}</td>
                        <td className="money shortfall" style={{ opacity: 0.7 }}>
                          {formatMoney(b.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {dashboardMode === "planning" && planningOutlookData.length > 1 && (
        <div className="card">
          <h2>{t("planning.outlookTitle")}</h2>
          <p className="muted">{t("planning.outlookIntro", { period: period.label })}</p>
          <div className="chart-container" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={planningOutlookData}>
                <XAxis dataKey="label" stroke="var(--text-muted)" />
                <YAxis stroke="var(--text-muted)" />
                <Tooltip formatter={moneyTooltip} />
                <ReferenceLine y={0} stroke="var(--rule)" />
                <Bar
                  dataKey="net"
                  name={t("planning.projectedNet")}
                  cursor="pointer"
                  onClick={handleBarClick}
                >
                  {planningOutlookData.map((row) => (
                    <Cell
                      key={row.label}
                      fill={row.net >= 0 ? "var(--accent)" : "var(--danger)"}
                      fillOpacity={row.isViewed ? 0.95 : 0.35}
                      stroke={row.isViewed ? "var(--gold)" : "none"}
                      strokeWidth={row.isViewed ? 1.5 : 0}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {chartData.length > 1 && (
        <div className="card ledger-feature">
          <h2>{t("chart.moneyInOutTitle")}</h2>
          <p className="muted">{t("chart.moneyInOutIntro")}</p>
          <div className="chart-container" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="label" stroke="var(--text-muted)" />
                <YAxis stroke="var(--text-muted)" />
                <Tooltip formatter={moneyTooltip} />
                <Legend />
                <Bar
                  dataKey="in"
                  name={t("chart.legend.in")}
                  stackId="in"
                  fill="var(--accent)"
                  cursor="pointer"
                  onClick={handleBarClick}
                />
                <Bar
                  dataKey="expectedIn"
                  name={t("chart.legend.expectedIn")}
                  stackId="in"
                  fill="var(--accent)"
                  fillOpacity={0.4}
                  cursor="pointer"
                  onClick={handleBarClick}
                />
                <Bar
                  dataKey="out"
                  name={t("chart.legend.out")}
                  stackId="out"
                  fill="var(--danger)"
                  cursor="pointer"
                  onClick={handleBarClick}
                />
                <Bar
                  dataKey="expectedOutCommitted"
                  name={t("chart.legend.expectedOutCommitted")}
                  stackId="out"
                  fill="var(--danger)"
                  fillOpacity={0.6}
                  cursor="pointer"
                  onClick={handleBarClick}
                />
                <Bar
                  dataKey="expectedOutAssumed"
                  name={t("chart.legend.expectedOutAssumed")}
                  stackId="out"
                  fill="var(--danger)"
                  fillOpacity={0.25}
                  cursor="pointer"
                  onClick={handleBarClick}
                />
                <Line
                  type="monotone"
                  dataKey="netRollingAvg"
                  name={t("chart.legend.netRollingAvg")}
                  stroke="var(--gold)"
                  strokeWidth={2}
                  dot={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {chartData.length > 1 && (
        <div className="card">
          <button className="disclosure" onClick={() => setBalanceOverTimeOpen((o) => !o)}>
            {balanceOverTimeOpen ? <FiChevronDown /> : <FiChevronRight />}{" "}
            {t("chart.balanceOverTime")}
          </button>
          {balanceOverTimeOpen && (
            <div style={{ marginTop: 12 }}>
              <p className="muted">{t("chart.balanceOverTimeIntro")}</p>
              <div className="chart-container" style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <XAxis dataKey="label" stroke="var(--text-muted)" />
                    <YAxis stroke="var(--text-muted)" />
                    <Tooltip formatter={moneyTooltip} />
                    <Line
                      type="monotone"
                      dataKey="balance"
                      name={t("chart.balanceLineLabel")}
                      stroke="var(--gold)"
                      dot={(props: any) => (
                        <circle
                          key={props.payload.label}
                          cx={props.cx}
                          cy={props.cy}
                          r={4}
                          fill="var(--gold)"
                          style={{ cursor: "pointer" }}
                          onClick={() => handleBarClick(props)}
                        />
                      )}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {dashboardMode === "trends" && topCategoriesOverTime.topNames.length > 0 && (
        <div className="card">
          <h2>{t("chart.topCategoriesTitle")}</h2>
          <p className="muted">
            {t("chart.topCategoriesIntro", { count: topCategoriesOverTime.topNames.length })}
          </p>
          <div className="chart-container" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={topCategoriesOverTime.monthly}>
                <XAxis dataKey="label" stroke="var(--text-muted)" />
                <YAxis stroke="var(--text-muted)" />
                <Tooltip formatter={moneyTooltip} />
                <Legend
                  onClick={(entry: any) => entry?.value && toggleTrendCategory(entry.value)}
                  wrapperStyle={{ cursor: "pointer" }}
                  formatter={(value: string) => (
                    <span
                      style={{
                        opacity: hiddenTrendCategories.has(value) ? 0.4 : 1,
                        textDecoration: hiddenTrendCategories.has(value) ? "line-through" : "none",
                      }}
                    >
                      {value}
                    </span>
                  )}
                />
                {topCategoriesOverTime.topNames.map((name) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    name={name}
                    hide={hiddenTrendCategories.has(name)}
                    stroke={categoryColorByName.get(name) ?? FALLBACK_CATEGORY_COLOR}
                    dot={(props: any) => (
                      <circle
                        key={props.payload.label}
                        cx={props.cx}
                        cy={props.cy}
                        r={3}
                        fill={categoryColorByName.get(name) ?? FALLBACK_CATEGORY_COLOR}
                        style={{ cursor: "pointer" }}
                        onClick={() => handleBarClick(props)}
                      />
                    )}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {cardAccounts.length > 0 && (
        <div className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <h2 style={{ margin: 0 }}>
              {cardSpendChartData.length > 1
                ? t("chart.cardSpendTitlePerMonth")
                : t("chart.cardSpendTitleThisMonth")}
            </h2>
            <div className="toggle-group">
              <button
                type="button"
                className={cardChartGrouping === "card" ? "active" : undefined}
                onClick={() => setCardChartGrouping("card")}
              >
                {t("chart.byCard")}
              </button>
              <button
                type="button"
                className={cardChartGrouping === "category" ? "active" : undefined}
                onClick={() => setCardChartGrouping("category")}
              >
                {t("chart.byCategory")}
              </button>
            </div>
          </div>
          <p className="muted">
            {cardSpendChartData.length > 1
              ? t("chart.cardSpendIntroPerMonth")
              : t("chart.cardSpendIntroThisMonth")}
            {cardChartGrouping === "card"
              ? t("chart.cardSpendByCardExtra")
              : t("chart.cardSpendByCategoryExtra")}
          </p>
          <div className="chart-container" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              {cardChartGrouping === "card" ? (
                <BarChart data={cardSpendChartDataWithExpectedBills}>
                  <XAxis dataKey="label" stroke="var(--text-muted)" />
                  <YAxis stroke="var(--text-muted)" />
                  <Tooltip formatter={moneyTooltip} />
                  <Legend />
                  {cardAccounts.map((card, i) => (
                    <Bar
                      key={card.id}
                      dataKey={card.name}
                      name={card.name}
                      stackId="cards"
                      fill={CARD_COLORS[i % CARD_COLORS.length]}
                      cursor="pointer"
                      onClick={handleBarClick}
                    />
                  ))}
                  <Bar
                    dataKey="expectedBillsCommitted"
                    name={t("chart.expectedCommitted")}
                    stackId="cards"
                    fill="var(--text-muted)"
                    fillOpacity={0.6}
                    cursor="pointer"
                    onClick={handleBarClick}
                  />
                  <Bar
                    dataKey="expectedBillsAssumed"
                    name={t("chart.expectedAssumed")}
                    stackId="cards"
                    fill="var(--text-muted)"
                    fillOpacity={0.25}
                    cursor="pointer"
                    onClick={handleBarClick}
                  />
                  {settings?.cardSpendGoal != null && (
                    <ReferenceLine
                      y={settings.cardSpendGoal}
                      stroke="var(--text-muted)"
                      strokeDasharray="4 4"
                      label={{
                        value: t("chart.goalLabel", {
                          amount: formatMoney(settings.cardSpendGoal),
                        }),
                        position: "insideTopLeft",
                        fill: "var(--text-muted)",
                        fontSize: 11,
                      }}
                    />
                  )}
                </BarChart>
              ) : (
                <BarChart data={cardCategorySpendByMonth}>
                  <XAxis dataKey="label" stroke="var(--text-muted)" />
                  <YAxis stroke="var(--text-muted)" />
                  <Tooltip formatter={moneyTooltip} />
                  <Legend />
                  {cardCategoryNames.map((name) => (
                    <Bar
                      key={name}
                      dataKey={name}
                      name={name}
                      stackId="categories"
                      fill={categoryColorByName.get(name) ?? FALLBACK_CATEGORY_COLOR}
                      cursor="pointer"
                      onClick={handleBarClick}
                    />
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {dashboardMode === "review" && (
        <div className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <h2 style={{ margin: 0 }}>{t("chart.inOutByCategoryTitle")}</h2>
            <label style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={includeCardSpend}
                onChange={(e) => setIncludeCardSpend(e.target.checked)}
              />
              {t("chart.includeCardActivity")}
            </label>
          </div>
          <p className="muted">
            {includeCardSpend ? t("chart.inOutIncludedNote") : t("chart.inOutExcludedNote")}{" "}
            {t("chart.clickSliceHint")}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            <div style={{ paddingRight: 24 }}>
              <h3 style={{ textAlign: "center", margin: 0 }}>{t("summary.moneyIn")}</h3>
              <p
                className="money"
                style={{
                  textAlign: "center",
                  margin: "4px 0 0",
                  color: "var(--accent)",
                  fontWeight: 600,
                  fontSize: 18,
                }}
              >
                {formatMoney(inByCategory.reduce((sum, c) => sum + c.value, 0))}
              </p>
              <CategoryPie
                data={inByCategory}
                type="CREDIT"
                drilldown={drilldown}
                onSelect={(type, category) => setDrilldown(category ? { type, category } : null)}
                hoveredCategory={hoveredCategory}
                onHoverChange={setHoveredCategory}
                categoryColorByName={categoryColorByName}
              />
            </div>
            <div style={{ paddingLeft: 24, borderLeft: "1px solid var(--rule)" }}>
              <h3 style={{ textAlign: "center", margin: 0 }}>{t("summary.moneyOut")}</h3>
              <p
                className="money"
                style={{
                  textAlign: "center",
                  margin: "4px 0 0",
                  color: "var(--danger)",
                  fontWeight: 600,
                  fontSize: 18,
                }}
              >
                {formatMoney(outByCategory.reduce((sum, c) => sum + c.value, 0))}
              </p>
              <CategoryPie
                data={outByCategory}
                type="DEBIT"
                drilldown={drilldown}
                onSelect={(type, category) => setDrilldown(category ? { type, category } : null)}
                hoveredCategory={hoveredCategory}
                onHoverChange={setHoveredCategory}
                categoryColorByName={categoryColorByName}
              />
            </div>
          </div>
        </div>
      )}

      {drilldown && (
        <div className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <h2>
              {drilldown.type === "CREDIT" ? t("summary.moneyIn") : t("summary.moneyOut")} —{" "}
              {drilldown.category}
            </h2>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <label style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={groupDrilldown}
                  onChange={(e) => setGroupDrilldown(e.target.checked)}
                />
                {t("drilldown.groupByDescription")}
              </label>
              <button
                className="secondary icon"
                onClick={() => setDrilldown(null)}
                title={t("drilldown.close")}
              >
                <FiX />
              </button>
            </div>
          </div>
          {drilldownTx.length === 0 ? (
            <p className="muted">{t("drilldown.empty")}</p>
          ) : groupDrilldown ? (
            <GroupedTransactionList transactions={drilldownTx} categories={categories ?? []} />
          ) : (
            <SortableTransactionTable transactions={drilldownTx} />
          )}
        </div>
      )}
    </div>
  );
}
