import { Fragment, useState } from "react";
import { FiCheck, FiChevronDown, FiChevronRight, FiEdit2, FiTrash2, FiX } from "react-icons/fi";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Debt, Goal, ProjectedMonth } from "shared";
import { PeriodPicker } from "../components/PeriodPicker";
import { SortableTh } from "../components/SortableTh";
import { NewGoalForm } from "../components/NewGoalForm";
import { SummaryCard } from "../components/SummaryCard";
import { WhatIfBillTable } from "../components/WhatIfBillTable";
import { useBills } from "../hooks/useBills";
import { useDebts } from "../hooks/useDebts";
import { useDeleteGoal, useGoals, useUpdateGoal } from "../hooks/useGoals";
import { useProjections, useWhatIfProjection } from "../hooks/useProjections";
import { useSettings } from "../hooks/useSettings";
import { useSortableTable } from "../hooks/useSortableTable";
import { formatMoney, moneyTooltip } from "../lib/format";
import { periodFor, type Period } from "../lib/period";
import { usePersonScope } from "../lib/personScope";
import {
  DEBT_MARKER_COLOR,
  DEFAULT_INTEREST_RATE_ANNUAL_PERCENT,
  GOAL_MARKER_COLOR,
  GRANULARITY_TO_HORIZON_MONTHS,
  PROJECTION_GRANULARITIES,
} from "../config";

// One hue per KIND of thing across these charts: balance = --accent green,
// interest = --gold (yield) — also used for the "debt paid off" star marker
// on the balance chart, since it's an event on the SAME timeline as interest
// accrual, not a fill competing with the shortfall reference line/dot (which
// keeps --danger). DEBT_MARKER_COLOR (--danger red, "red symbolizing debt"
// per explicit direction) labels the tooltip's "X pays off" line. Goal
// targets get a slate blue that isn't in the app's warm ledger palette
// elsewhere, chosen specifically so it can't be confused with the green/red
// pair under red-green colorblindness the way an earlier rose did. A goal's
// own identity still comes from its name label on the marker, not the color
// slot alone.

// A 5-point star's SVG path, centered at (cx, cy) — used both for the "debt
// paid off" chip icon in the key strip and the marker on the balance line
// itself at that month, so the same glyph means the same thing in both
// places.
function starPathD(cx: number, cy: number, outerR: number, innerR: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return `M ${points.join(" L ")} Z`;
}

// Each plotted month: the projection's own numbers plus the fields the
// balance chart derives — the baseline overlay value, and the month's
// interest line (kind "interest" in the itemized bills) pulled out so the
// chart can show accrual per month and running total.
type BalancePoint = ProjectedMonth & {
  baselineBalance: number | null;
  interest: number;
  interestToDate: number;
};

// A native SVG <title> on the balance dot itself doesn't reliably show —
// recharts tracks hover via its own invisible overlay + activeDot, which sits
// on top of a custom dot shape and intercepts the pointer before a nested
// <title> ever gets it. Piggybacking on recharts' own (already-working)
// tooltip content instead guarantees this fires on the same hover recharts
// already detects, no pixel-perfect aim at a 4px circle required. Reuses the
// stock recharts-* class names so the existing dark-tooltip CSS fix applies
// without duplicating it.
function BalanceTooltip(props: {
  active?: boolean;
  label?: string;
  payload?: {
    name?: string;
    value?: number;
    color?: string;
    dataKey?: string;
    payload?: BalancePoint;
  }[];
  debtEndMarkers: { id: number; name: string; projected_finish_date: string }[];
  goals: Goal[];
}) {
  const { t } = useTranslation("projections");
  if (!props.active || !props.payload || props.payload.length === 0) return null;
  const finishing = props.debtEndMarkers.filter(
    (d) => d.projected_finish_date.slice(0, 7) === props.label
  );
  const goalsDue = props.goals.filter((g) => g.target_date.slice(0, 7) === props.label);
  const point = props.payload[0]?.payload;
  return (
    <div className="recharts-default-tooltip" style={{ padding: "8px 12px", borderRadius: 4 }}>
      <p className="recharts-tooltip-label" style={{ margin: "0 0 4px" }}>
        {props.label}
      </p>
      {props.payload.map((p) => (
        <p key={p.dataKey} className="recharts-tooltip-item" style={{ margin: 0, color: p.color }}>
          {p.name}: {formatMoney(Number(p.value))}
        </p>
      ))}
      {point != null && point.interest !== 0 && (
        <p className="recharts-tooltip-item" style={{ margin: 0, color: "var(--gold)" }}>
          {t("balanceChart.tooltip.interest", {
            sign: point.interest > 0 ? "+" : "",
            amount: formatMoney(point.interest),
            accrued: formatMoney(point.interestToDate),
          })}
        </p>
      )}
      {finishing.length > 0 && (
        <p
          className="recharts-tooltip-item"
          style={{ margin: "4px 0 0", color: DEBT_MARKER_COLOR, fontWeight: 600 }}
        >
          {finishing.map((d) => t("balanceChart.tooltip.debtPaysOff", { name: d.name })).join(", ")}
        </p>
      )}
      {goalsDue.map((g) => (
        <p
          key={g.id}
          className="recharts-tooltip-item"
          style={{ margin: "4px 0 0", color: GOAL_MARKER_COLOR, fontWeight: 600 }}
        >
          {t("balanceChart.tooltip.goal", {
            name: g.name,
            amount: formatMoney(g.target_amount),
            status: g.on_track ? t("status.onTrack") : t("status.behind"),
          })}
        </p>
      ))}
    </div>
  );
}

function InterestTooltip(props: {
  active?: boolean;
  label?: string;
  payload?: { payload?: BalancePoint }[];
}) {
  const { t } = useTranslation("projections");
  const point = props.payload?.[0]?.payload;
  if (!props.active || point == null) return null;
  return (
    <div className="recharts-default-tooltip" style={{ padding: "8px 12px", borderRadius: 4 }}>
      <p className="recharts-tooltip-label" style={{ margin: "0 0 4px" }}>
        {props.label}
      </p>
      <p className="recharts-tooltip-item" style={{ margin: 0, color: "var(--gold)" }}>
        {t("interestChart.tooltip.thisMonth", { amount: formatMoney(point.interest) })}
      </p>
      <p className="recharts-tooltip-item" style={{ margin: 0 }}>
        {t("interestChart.tooltip.accrued", { amount: formatMoney(point.interestToDate) })}
      </p>
    </div>
  );
}

function ScenarioBadge() {
  const { t } = useTranslation("projections");
  return (
    <span
      className="badge"
      style={{
        color: "var(--gold)",
        borderColor: "var(--gold)",
        fontFamily: "var(--font-sans)",
        fontWeight: 500,
      }}
    >
      {t("scenario.badge")}
    </span>
  );
}

function GoalStatusCell(props: { goal: Goal }) {
  const { t } = useTranslation("projections");
  const g = props.goal;
  const margin = g.projected_monthly_savings - g.required_monthly_savings;
  const ratio =
    g.required_monthly_savings > 0
      ? Math.max(0, Math.min(1, g.projected_monthly_savings / g.required_monthly_savings))
      : 1;
  return (
    <td>
      <span className={g.on_track ? "gain" : "shortfall"}>
        {g.on_track ? t("status.onTrack") : t("status.behind")}
      </span>
      <div
        style={{
          width: 90,
          height: 4,
          background: "var(--rule)",
          borderRadius: 2,
          margin: "6px 0 4px",
        }}
      >
        <div
          style={{
            width: `${ratio * 100}%`,
            height: "100%",
            borderRadius: 2,
            background: g.on_track ? "var(--accent)" : "var(--danger)",
          }}
        />
      </div>
      <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
        {g.on_track
          ? t("goals.table.marginToSpare", { amount: formatMoney(Math.abs(margin)) })
          : t("goals.table.marginShort", { amount: formatMoney(Math.abs(margin)) })}
      </span>
    </td>
  );
}

function MonthlyBreakdownTable(props: { months: ProjectedMonth[] }) {
  const { t } = useTranslation("projections");
  const lineKindLabel: Record<"bill" | "debt" | "interest" | "cardSpend", string> = {
    bill: t("breakdown.kind.bill"),
    debt: t("breakdown.kind.debt"),
    interest: t("breakdown.kind.interest"),
    cardSpend: t("breakdown.kind.cardSpend"),
  };
  const [expanded, setExpanded] = useState<number | null>(null);
  const {
    sorted: sortedMonths,
    sortKey: monthSortKey,
    direction: monthSortDirection,
    toggleSort: toggleMonthSort,
  } = useSortableTable<ProjectedMonth>(
    props.months,
    (m, key) => {
      switch (key) {
        case "net":
          return m.net;
        case "balance":
          return m.balance;
        default:
          return m.label;
      }
    },
    // Chronological by default — months are generated in order, so sorting
    // by their natural array position (not re-sorted) reads best at rest.
    undefined
  );

  const expandedMonth = props.months.find((m) => m.monthIndex === expanded);
  const {
    sorted: sortedLines,
    sortKey: lineSortKey,
    direction: lineSortDirection,
    toggleSort: toggleLineSort,
  } = useSortableTable(
    expandedMonth?.bills ?? [],
    (line, key) => (key === "amount" ? line.amount : line.name),
    undefined
  );

  return (
    <table>
      <thead>
        <tr>
          <SortableTh
            label={t("breakdown.table.month")}
            sortKey="label"
            activeKey={monthSortKey}
            direction={monthSortDirection}
            onSort={toggleMonthSort}
          />
          <SortableTh
            label={t("breakdown.table.net")}
            sortKey="net"
            activeKey={monthSortKey}
            direction={monthSortDirection}
            onSort={toggleMonthSort}
          />
          <SortableTh
            label={t("breakdown.table.balance")}
            sortKey="balance"
            activeKey={monthSortKey}
            direction={monthSortDirection}
            onSort={toggleMonthSort}
          />
          <th />
        </tr>
      </thead>
      <tbody>
        {sortedMonths.map((m) => (
          <Fragment key={m.monthIndex}>
            <tr>
              <td>{m.label}</td>
              <td className={m.net < 0 ? "money shortfall" : "money"}>{formatMoney(m.net)}</td>
              <td className={m.shortfall ? "money shortfall" : "money"}>
                {formatMoney(m.balance)}
              </td>
              <td>
                <button
                  className="link-button"
                  onClick={() => setExpanded((e) => (e === m.monthIndex ? null : m.monthIndex))}
                >
                  {expanded === m.monthIndex ? <FiChevronDown /> : <FiChevronRight />}{" "}
                  {t("breakdown.table.linesButton")}
                </button>
              </td>
            </tr>
            {expanded === m.monthIndex && (
              <tr>
                <td colSpan={4} style={{ paddingTop: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <SortableTh
                          label={t("breakdown.detail.lineItem")}
                          sortKey="name"
                          activeKey={lineSortKey}
                          direction={lineSortDirection}
                          onSort={toggleLineSort}
                        />
                        <th>{t("breakdown.detail.kind")}</th>
                        <SortableTh
                          label={t("breakdown.detail.amount")}
                          sortKey="amount"
                          activeKey={lineSortKey}
                          direction={lineSortDirection}
                          onSort={toggleLineSort}
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedLines.map((line) => (
                        <tr key={line.id}>
                          <td>{line.name}</td>
                          <td className="muted" style={{ whiteSpace: "nowrap" }}>
                            {lineKindLabel[line.kind]}
                            {line.kind === "cardSpend" && (
                              <span
                                className="badge"
                                style={{ marginLeft: 8 }}
                                title={t("breakdown.detail.assumedTitle")}
                              >
                                {t("breakdown.detail.assumedBadge")}
                              </span>
                            )}
                          </td>
                          <td className={line.amount < 0 ? "money shortfall" : "money"}>
                            {formatMoney(line.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function monthsUntil(targetDate: string): number {
  const now = new Date();
  const target = new Date(targetDate);
  const months =
    (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  return Math.max(1, months);
}

export function ProjectionsPage() {
  const { t } = useTranslation("projections");
  const [period, setPeriod] = useState<Period>(() => periodFor("year"));
  // A goal's own date can fall well outside any fixed granularity step —
  // this overrides the granularity-derived horizon entirely rather than
  // trying to fit it into month/quarter/semester/year buckets.
  const [horizonOverride, setHorizonOverride] = useState<{ months: number; name: string } | null>(
    null
  );
  const horizonMonths =
    horizonOverride?.months ?? GRANULARITY_TO_HORIZON_MONTHS[period.granularity];

  const { data: baseline } = useProjections(horizonMonths);
  const { data: bills } = useBills();
  const { data: debts } = useDebts();
  const { data: settings } = useSettings();
  const { activeUserId } = usePersonScope();
  const whatIf = useWhatIfProjection();

  const [billAmounts, setBillAmounts] = useState<Record<number, number>>({});
  const [discretionaryDeltaPercent, setDiscretionaryDeltaPercent] = useState(0);
  const [interestRateAnnualPercent, setInterestRateAnnualPercent] = useState(
    DEFAULT_INTEREST_RATE_ANNUAL_PERCENT
  );
  // Read-only here — the card spend goal is edited from /config now (one
  // canonical place to set it per person), not duplicated as an editable
  // field on the planning page too. Still fed into recompute() below so
  // other what-if scenario changes (discretionary %, interest rate) keep
  // using the real persisted goal, not a blank default.
  const cardSpendGoal = settings?.cardSpendGoal != null ? String(settings.cardSpendGoal) : "";

  const activeBills = (bills ?? []).filter((b) => b.confirmed && b.active);
  const incomeBills = activeBills.filter((b) => b.category_kind === "income");
  const expenseBills = activeBills.filter((b) => b.category_kind !== "income");
  const {
    sorted: sortedIncomeBills,
    sortKey: incomeSortKey,
    direction: incomeSortDirection,
    toggleSort: toggleIncomeSort,
  } = useSortableTable(
    incomeBills,
    (b, key) => (key === "expected" ? b.expected_amount : b.name),
    "name"
  );
  const {
    sorted: sortedExpenseBills,
    sortKey: expenseSortKey,
    direction: expenseSortDirection,
    toggleSort: toggleExpenseSort,
  } = useSortableTable(
    expenseBills,
    (b, key) => (key === "expected" ? b.expected_amount : b.name),
    "name"
  );
  const result = whatIf.data ?? baseline;
  const hasShortfall = result?.months.some((m) => m.shortfall) ?? false;

  const months = result?.months ?? [];
  const lastMonth = months[months.length - 1];
  const firstShortfall = months.find((m) => m.shortfall);
  const avgNet = months.length > 0 ? months.reduce((sum, m) => sum + m.net, 0) / months.length : 0;
  const startingBalance = result?.startingBalance ?? 0;
  const endBalance = lastMonth?.balance ?? startingBalance;
  // The card spend goal is a standing setting, not a hypothetical, so it
  // doesn't count toward "you're looking at a scenario".
  const scenarioActive =
    Object.keys(billAmounts).length > 0 ||
    discretionaryDeltaPercent !== 0 ||
    interestRateAnnualPercent !== DEFAULT_INTEREST_RATE_ANNUAL_PERCENT;
  const baselineMonths = baseline?.months ?? [];
  const baselineEndBalance = baselineMonths[baselineMonths.length - 1]?.balance;
  const showBaselineOverlay =
    scenarioActive && whatIf.data != null && baselineMonths.length === months.length;
  // Pull each month's interest line out of the itemized bills (kind
  // "interest" — the compounding interest the projection already applied to
  // the balance) so the chart can show accrual alongside the trajectory,
  // per month and as a running total.
  const monthlyInterest = months.map((m) =>
    m.bills.filter((b) => b.kind === "interest").reduce((sum, b) => sum + b.amount, 0)
  );
  const balanceChartData: BalancePoint[] = months.map((m, i) => ({
    ...m,
    baselineBalance: baselineMonths[i]?.balance ?? null,
    interest: monthlyInterest[i]!,
    interestToDate: monthlyInterest.slice(0, i + 1).reduce((sum, v) => sum + v, 0),
  }));
  const totalInterest = monthlyInterest.reduce((sum, v) => sum + v, 0);
  const balanceGrowth = endBalance - startingBalance;
  // "How much of this climb is just interest?" — only meaningful when the
  // balance actually grows and interest contributed something.
  const interestShareOfGrowth =
    balanceGrowth > 0 && totalInterest > 0 ? totalInterest / balanceGrowth : null;

  const [breakdownOpen, setBreakdownOpen] = useState(true);

  const { data: goals } = useGoals();
  const goalCount = (goals ?? []).length;
  const goalsOnTrack = (goals ?? []).filter((g) => g.on_track).length;
  // A debt's own projected finish date — the same server-computed date the
  // Debts page's own "Finish date" stat shows (see projected_finish_date,
  // computeProjectedFinishDate in backend/src/routes/debts.ts). This is NOT
  // target_payoff_date (a loan's plain contractual end, ignoring any
  // extra-amortization bills linked to it) — using that instead would show a
  // date years later than the debt will actually pay off.
  const debtEndMarkers = (debts ?? []).filter(
    (d): d is Debt & { projected_finish_date: string } =>
      d.status === "active" && d.projected_finish_date != null
  );
  const {
    sorted: sortedGoals,
    sortKey: goalSortKey,
    direction: goalSortDirection,
    toggleSort: toggleGoalSort,
  } = useSortableTable(
    goals ?? [],
    (g, key) => {
      switch (key) {
        case "target":
          return g.target_amount;
        case "by":
          return g.target_date;
        case "needPerMonth":
          return g.required_monthly_savings;
        case "projectedPerMonth":
          return g.projected_monthly_savings;
        case "onTrack":
          return g.on_track ? 1 : 0;
        default:
          return g.name;
      }
    },
    "by"
  );
  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();
  const [editingGoalId, setEditingGoalId] = useState<number | null>(null);
  const [editGoalName, setEditGoalName] = useState("");
  const [editGoalAmount, setEditGoalAmount] = useState("");
  const [editGoalDate, setEditGoalDate] = useState("");

  function startEditGoal(g: {
    id: number;
    name: string;
    target_amount: number;
    target_date: string;
  }) {
    setEditingGoalId(g.id);
    setEditGoalName(g.name);
    setEditGoalAmount(String(g.target_amount));
    setEditGoalDate(g.target_date);
  }

  function saveEditGoal() {
    if (editingGoalId === null) return;
    updateGoal.mutate(
      {
        id: editingGoalId,
        input: {
          name: editGoalName,
          targetAmount: Number(editGoalAmount),
          targetDate: editGoalDate,
        },
      },
      { onSuccess: () => setEditingGoalId(null) }
    );
  }

  function recompute(
    nextBillAmounts: Record<number, number>,
    nextDiscretionary: number,
    nextInterestRate: number,
    nextCardSpendGoal: string
  ) {
    whatIf.mutate({
      horizonMonths,
      billOverrides: Object.entries(nextBillAmounts).map(([billId, amount]) => ({
        billId: Number(billId),
        amount,
      })),
      discretionaryDeltaPercent: nextDiscretionary,
      interestRateAnnualPercent: nextInterestRate,
      cardSpendGoal: nextCardSpendGoal === "" ? undefined : Number(nextCardSpendGoal),
    });
  }

  function handleBillOverrideChange(billId: number, value: number | undefined) {
    const next = { ...billAmounts };
    if (value === undefined) delete next[billId];
    else next[billId] = value;
    setBillAmounts(next);
    recompute(next, discretionaryDeltaPercent, interestRateAnnualPercent, cardSpendGoal);
  }

  // cardSpendGoal is a persisted global setting now, not a per-view
  // what-if — it survives resets and period switches, never blanked here.
  function resetWhatIf() {
    setBillAmounts({});
    setDiscretionaryDeltaPercent(0);
    setInterestRateAnnualPercent(DEFAULT_INTEREST_RATE_ANNUAL_PERCENT);
    whatIf.reset();
  }

  function handlePeriodChange(nextPeriod: Period) {
    setPeriod(nextPeriod);
    setHorizonOverride(null);
    resetWhatIf();
  }

  function spanUntilFurthestMarker() {
    const candidates = [
      ...(goals ?? []).map((g) => ({ targetDate: g.target_date, name: g.name })),
      ...debtEndMarkers.map((d) => ({ targetDate: d.projected_finish_date, name: d.name })),
    ];
    if (candidates.length === 0) return;
    const latest = [...candidates].sort((a, b) => b.targetDate.localeCompare(a.targetDate))[0]!;
    // +1 month of buffer beyond the exact target — otherwise its marker lands
    // right on the last plotted point, where recharts can clip the dotted
    // line/label against the chart's edge instead of actually showing it.
    setHorizonOverride({ months: monthsUntil(latest.targetDate) + 1, name: latest.name });
    resetWhatIf();
  }

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <PeriodPicker
              value={period}
              onChange={handlePeriodChange}
              showNavigation={false}
              granularities={PROJECTION_GRANULARITIES}
            />
            {(goalCount > 0 || debtEndMarkers.length > 0) && (
              <button
                className={horizonOverride ? undefined : "secondary"}
                onClick={spanUntilFurthestMarker}
                title={t("horizon.spanButton.title")}
              >
                {t("horizon.spanButton.label")}
              </button>
            )}
          </div>
          {horizonOverride && (
            <span className="muted" style={{ fontSize: 13 }}>
              {t("horizon.override", { months: horizonMonths, name: horizonOverride.name })}
            </span>
          )}
          {scenarioActive && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ScenarioBadge />
              <button className="secondary" onClick={resetWhatIf}>
                {t("scenario.reset")}
              </button>
            </div>
          )}
        </div>
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}
        >
          <SummaryCard
            label={t("summary.balance.label", { month: lastMonth?.label ?? "—" })}
            value={formatMoney(endBalance)}
            tone={
              !lastMonth
                ? undefined
                : endBalance < 0
                  ? "bad"
                  : endBalance >= startingBalance
                    ? "good"
                    : undefined
            }
            caption={
              t("summary.balance.caption", {
                delta: `${endBalance - startingBalance >= 0 ? "+" : ""}${formatMoney(endBalance - startingBalance)}`,
              }) +
              (scenarioActive && baselineEndBalance != null
                ? ` · ${t("summary.balance.baselineSuffix", { amount: formatMoney(baselineEndBalance) })}`
                : "")
            }
          />
          <SummaryCard
            label={t("summary.avgNet.label")}
            value={formatMoney(avgNet)}
            tone={months.length === 0 ? undefined : avgNet >= 0 ? "good" : "bad"}
            caption={t("summary.avgNet.caption", { count: months.length })}
          />
          <SummaryCard
            label={t("summary.firstShortfall.label")}
            value={
              firstShortfall?.label ?? (months.length > 0 ? t("summary.firstShortfall.none") : "—")
            }
            tone={months.length === 0 ? undefined : firstShortfall ? "bad" : "good"}
            caption={
              firstShortfall
                ? t("summary.firstShortfall.captionNegative")
                : t("summary.firstShortfall.captionPositive")
            }
          />
          <SummaryCard
            label={t("summary.goalsOnTrack.label")}
            value={
              goalCount === 0
                ? "—"
                : t("summary.goalsOnTrack.value", { onTrack: goalsOnTrack, total: goalCount })
            }
            tone={goalCount === 0 ? undefined : goalsOnTrack === goalCount ? "good" : "bad"}
            caption={
              goalCount === 0
                ? t("summary.goalsOnTrack.captionEmpty")
                : goalsOnTrack === goalCount
                  ? t("summary.goalsOnTrack.captionAllOnTrack")
                  : t("summary.goalsOnTrack.captionSomeBehind")
            }
          />
        </div>
      </div>

      <div className="card">
        <h2 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {t("balanceChart.title")}
          {scenarioActive && <ScenarioBadge />}
        </h2>
        {/* Key strip: identity lives here in colored glyphs, text stays in
            muted ink. Debt payoffs get one chip each (the chip IS the legend
            entry), so "are we paying off our debts" is readable at rest —
            including debts whose finish date falls beyond the plotted
            horizon, which the chart itself can't show at all. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            rowGap: 6,
            flexWrap: "wrap",
            marginBottom: 10,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <svg width="14" height="10" aria-hidden="true">
              <line x1="0" y1="5" x2="14" y2="5" stroke="var(--accent)" strokeWidth="2" />
            </svg>
            {showBaselineOverlay
              ? t("balanceChart.legend.whatIfBalance")
              : t("balanceChart.legend.balance")}
          </span>
          {showBaselineOverlay && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <svg width="14" height="10" aria-hidden="true">
                <line
                  x1="0"
                  y1="5"
                  x2="14"
                  y2="5"
                  stroke="var(--text-muted)"
                  strokeWidth="2"
                  strokeDasharray="4 3"
                />
              </svg>
              {t("balanceChart.legend.baseline")}
            </span>
          )}
          {(goals ?? []).some((g) => g.on_track) && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <svg width="12" height="12" aria-hidden="true">
                <circle cx="6" cy="6" r="4.5" fill={GOAL_MARKER_COLOR} />
              </svg>
              {t("balanceChart.legend.goalOnTrack")}
            </span>
          )}
          {(goals ?? []).some((g) => !g.on_track) && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <svg width="12" height="12" aria-hidden="true">
                <circle
                  cx="6"
                  cy="6"
                  r="4"
                  fill="none"
                  stroke={GOAL_MARKER_COLOR}
                  strokeWidth="2"
                />
              </svg>
              {t("balanceChart.legend.goalBehind")}
            </span>
          )}
          {hasShortfall && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <svg width="12" height="12" aria-hidden="true">
                <circle cx="6" cy="6" r="4.5" fill="var(--danger)" />
              </svg>
              {t("balanceChart.legend.shortfall")}
            </span>
          )}
          {debtEndMarkers.map((d) => {
            const finishMonth = d.projected_finish_date.slice(0, 7);
            const inView = months.some((m) => m.label === finishMonth);
            return (
              <span key={d.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <svg width="12" height="12" aria-hidden="true">
                  <path d={starPathD(6, 6, 5, 2.2)} fill="var(--gold)" />
                </svg>
                {t("balanceChart.legend.debtPaidOff", { name: d.name, month: finishMonth })}
                {inView ? "" : t("balanceChart.legend.beyondView")}
              </span>
            );
          })}
        </div>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={balanceChartData} syncId="balance-projection">
              <XAxis dataKey="label" stroke="var(--text-muted)" />
              <YAxis stroke="var(--text-muted)" width={60} />
              <Tooltip
                content={<BalanceTooltip debtEndMarkers={debtEndMarkers} goals={goals ?? []} />}
              />
              {showBaselineOverlay && (
                <Line
                  type="monotone"
                  dataKey="baselineBalance"
                  name={t("balanceChart.legend.baseline")}
                  stroke="var(--text-muted)"
                  strokeDasharray="6 4"
                  dot={false}
                />
              )}
              <Line
                type="monotone"
                dataKey="balance"
                name={
                  showBaselineOverlay
                    ? t("balanceChart.whatIfLineLabel")
                    : t("balanceChart.legend.balance")
                }
                stroke="var(--accent)"
                strokeWidth={2}
                dot={(props: any) => {
                  // A debt paying off this month gets a star on the balance
                  // line itself, right where the trajectory actually sits —
                  // not its own fill/curve. Debt principal (can be hundreds
                  // of thousands) and a checking-account balance live on
                  // wildly different scales; encoding a debt's own remaining
                  // amount as height on this shared axis either swamps the
                  // balance line or is invisible next to it. The marker only
                  // needs to say *when*; *how much* lives in the tooltip.
                  const paidOff = debtEndMarkers.some(
                    (d) => d.projected_finish_date.slice(0, 7) === props.payload.label
                  );
                  if (paidOff) {
                    return (
                      <path
                        key={props.payload.monthIndex}
                        d={starPathD(props.cx, props.cy, 7, 3)}
                        fill="var(--gold)"
                        stroke="var(--ink-raised)"
                        strokeWidth={1}
                      />
                    );
                  }
                  return (
                    <circle
                      key={props.payload.monthIndex}
                      cx={props.cx}
                      cy={props.cy}
                      r={props.payload.shortfall ? 4 : 3}
                      fill={props.payload.shortfall ? "var(--danger)" : "var(--accent)"}
                    />
                  );
                }}
              />
              {hasShortfall && <ReferenceLine y={0} stroke="var(--danger)" strokeOpacity={0.5} />}
              {(goals ?? []).map((g) => {
                // target_date is "YYYY-MM-DD"; month labels are "YYYY-MM" —
                // a goal only gets its target-point marker if its month is
                // actually plotted (it can fall outside the current horizon).
                const goalMonth = g.target_date.slice(0, 7);
                const goalInView = months.some((m) => m.label === goalMonth);
                const statusGlyph = g.on_track ? "✓" : "!";
                // extendDomain matters: without it a target amount above the
                // projected balance is silently clipped off the chart — and a
                // goal you're NOT reaching is exactly the one you need to see.
                if (goalInView && months[0]) {
                  return (
                    <Fragment key={g.id}>
                      {/* Dashed guide from the left edge to the target month
                          keeps the amount readable against the y-axis; the
                          marker itself carries the goal: filled = on track,
                          hollow = behind (status by fill + the label glyph,
                          never by repainting the goal's identity hue). */}
                      <ReferenceLine
                        segment={[
                          { x: months[0].label, y: g.target_amount },
                          { x: goalMonth, y: g.target_amount },
                        ]}
                        stroke={GOAL_MARKER_COLOR}
                        strokeOpacity={0.45}
                        strokeDasharray="4 4"
                        ifOverflow="extendDomain"
                      />
                      <ReferenceDot
                        x={goalMonth}
                        y={g.target_amount}
                        ifOverflow="extendDomain"
                        shape={(p: any) => (
                          <circle
                            cx={p.cx}
                            cy={p.cy}
                            r={5}
                            fill={g.on_track ? GOAL_MARKER_COLOR : "var(--ink-raised)"}
                            stroke={GOAL_MARKER_COLOR}
                            strokeWidth={2}
                          />
                        )}
                        label={{
                          value: `${statusGlyph} ${g.name} · ${formatMoney(g.target_amount)}`,
                          position: "top",
                          fill: GOAL_MARKER_COLOR,
                          fontSize: 11,
                        }}
                      />
                    </Fragment>
                  );
                }
                // Goal month beyond the plotted horizon: no in-view x to
                // anchor a marker to, so a full-width line at the target
                // amount, labeled with when it's due.
                return (
                  <ReferenceLine
                    key={g.id}
                    y={g.target_amount}
                    stroke={GOAL_MARKER_COLOR}
                    strokeOpacity={0.45}
                    strokeDasharray="4 4"
                    ifOverflow="extendDomain"
                    label={{
                      value: t("balanceChart.goalLabel.dueBy", {
                        glyph: statusGlyph,
                        name: g.name,
                        amount: formatMoney(g.target_amount),
                        month: goalMonth,
                      }),
                      position: "insideTopLeft" as const,
                      fill: GOAL_MARKER_COLOR,
                      fontSize: 11,
                    }}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {/* Interest gets its own small synchronized panel rather than a line
            on the balance chart (monthly interest is ~1% of the balance, so
            it would flatline at the bottom) or a second y-axis (never).
            syncId ties hover to the chart above; the hidden x-axis borrows
            the month labels sitting directly between the two panels. */}
        {totalInterest !== 0 && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                flexWrap: "wrap",
                margin: "14px 0 6px",
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 15,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <svg width="10" height="10" aria-hidden="true">
                  <rect width="10" height="10" rx="2" fill="var(--gold)" />
                </svg>
                {t("interestChart.title")}
              </h3>
              <span className="muted" style={{ fontSize: 12 }}>
                {t("interestChart.caption", {
                  amount: formatMoney(totalInterest),
                  count: months.length,
                })}
                {interestShareOfGrowth != null &&
                  ` · ${t("interestChart.shareSuffix", { percent: Math.round(interestShareOfGrowth * 100) })}`}
              </span>
            </div>
            <div style={{ height: 110 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={balanceChartData} syncId="balance-projection">
                  <XAxis dataKey="label" hide />
                  <YAxis stroke="var(--text-muted)" width={60} tick={{ fontSize: 11 }} />
                  <Tooltip content={<InterestTooltip />} />
                  <Bar dataKey="interest" name={t("interestChart.barLabel")} fill="var(--gold)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h2 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {t("savingsChart.title")}
          {scenarioActive && <ScenarioBadge />}
        </h2>
        <p className="muted">{t("savingsChart.description")}</p>
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginBottom: 16 }}
        >
          <SummaryCard
            label={t("savingsChart.summary.startingBalance")}
            value={formatMoney(result?.startingBalance ?? 0)}
            caption={t("savingsChart.summary.startingBalanceCaption")}
          />
          <SummaryCard
            label={t("savingsChart.summary.cardSpendBaseline")}
            value={formatMoney(result?.cardSpendActualAverage ?? 0)}
            tone="negative"
          />
          <SummaryCard
            label={t("savingsChart.cardSpendGoal.label")}
            value={
              cardSpendGoal === ""
                ? t("savingsChart.cardSpendGoal.usingAverage")
                : formatMoney(Number(cardSpendGoal))
            }
            caption={
              <Link to={activeUserId != null ? `/config/users/${activeUserId}` : "/config"}>
                {activeUserId != null
                  ? t("savingsChart.cardSpendGoal.editHintPerson")
                  : t("savingsChart.cardSpendGoal.editHintHousehold")}
              </Link>
            }
          />
        </div>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={months}>
              <XAxis dataKey="label" stroke="var(--text-muted)" />
              <YAxis stroke="var(--text-muted)" />
              <Tooltip formatter={moneyTooltip} />
              <Bar dataKey="net" name={t("savingsChart.netSavingsLabel")} fill="var(--accent)">
                {months.map((m) => (
                  <Cell key={m.monthIndex} fill={m.net < 0 ? "var(--danger)" : "var(--accent)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <button
          className="disclosure"
          onClick={() => setBreakdownOpen((o) => !o)}
          style={{ marginTop: 16, fontSize: 16 }}
        >
          {breakdownOpen ? <FiChevronDown /> : <FiChevronRight />}{" "}
          {t("savingsChart.breakdownToggle")}
        </button>
        {breakdownOpen && <MonthlyBreakdownTable months={months} />}
      </div>

      <div className="card">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <h2 style={{ margin: 0 }}>{t("whatIf.title")}</h2>
          {scenarioActive && (
            <button className="secondary" onClick={resetWhatIf}>
              {t("scenario.reset")}
            </button>
          )}
        </div>
        <p className="muted" style={{ marginBottom: 16 }}>
          {t("whatIf.description")}
        </p>
        <label>
          {t("whatIf.discretionary.label", { value: discretionaryDeltaPercent })}
          <input
            type="range"
            min={-50}
            max={50}
            value={discretionaryDeltaPercent}
            onChange={(e) => {
              const value = Number(e.target.value);
              setDiscretionaryDeltaPercent(value);
              recompute(billAmounts, value, interestRateAnnualPercent, cardSpendGoal);
            }}
          />
        </label>

        <label style={{ display: "block", marginTop: 12 }}>
          {t("whatIf.interestRate.label", { value: interestRateAnnualPercent })}{" "}
          <span className="muted">{t("whatIf.interestRate.hint")}</span>
          <input
            type="number"
            step="0.01"
            min={0}
            value={interestRateAnnualPercent}
            onChange={(e) => {
              const value = Number(e.target.value);
              setInterestRateAnnualPercent(value);
              recompute(billAmounts, discretionaryDeltaPercent, value, cardSpendGoal);
            }}
            style={{ display: "block", width: 100, marginTop: 4 }}
          />
        </label>

        <div
          className="grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
            gap: 24,
            alignItems: "start",
            marginTop: 16,
          }}
        >
          <WhatIfBillTable
            title={t("whatIf.income.title")}
            bills={sortedIncomeBills}
            sign="+"
            sortKey={incomeSortKey}
            direction={incomeSortDirection}
            onSort={toggleIncomeSort}
            billAmounts={billAmounts}
            onOverrideChange={handleBillOverrideChange}
          />
          <WhatIfBillTable
            title={t("whatIf.expenses.title")}
            bills={sortedExpenseBills}
            sign="-"
            sortKey={expenseSortKey}
            direction={expenseSortDirection}
            onSort={toggleExpenseSort}
            billAmounts={billAmounts}
            onOverrideChange={handleBillOverrideChange}
          />
        </div>
      </div>

      <div className="card">
        <h2>{t("goals.title")}</h2>
        <p className="muted">{t("goals.description")}</p>
        <table>
          <thead>
            <tr>
              <SortableTh
                label={t("goals.table.name")}
                sortKey="name"
                activeKey={goalSortKey}
                direction={goalSortDirection}
                onSort={toggleGoalSort}
              />
              <SortableTh
                label={t("goals.table.target")}
                sortKey="target"
                activeKey={goalSortKey}
                direction={goalSortDirection}
                onSort={toggleGoalSort}
              />
              <SortableTh
                label={t("goals.table.by")}
                sortKey="by"
                activeKey={goalSortKey}
                direction={goalSortDirection}
                onSort={toggleGoalSort}
              />
              <SortableTh
                label={t("goals.table.needPerMonth")}
                sortKey="needPerMonth"
                activeKey={goalSortKey}
                direction={goalSortDirection}
                onSort={toggleGoalSort}
              />
              <SortableTh
                label={t("goals.table.projectedPerMonth")}
                sortKey="projectedPerMonth"
                activeKey={goalSortKey}
                direction={goalSortDirection}
                onSort={toggleGoalSort}
              />
              <SortableTh
                label={t("goals.table.onTrack")}
                sortKey="onTrack"
                activeKey={goalSortKey}
                direction={goalSortDirection}
                onSort={toggleGoalSort}
              />
              <th />
            </tr>
          </thead>
          <tbody>
            {sortedGoals.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {t("goals.table.empty")}
                </td>
              </tr>
            )}
            {sortedGoals.map((g) =>
              editingGoalId === g.id ? (
                <tr key={g.id}>
                  <td>
                    <input
                      type="text"
                      value={editGoalName}
                      onChange={(e) => setEditGoalName(e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      value={editGoalAmount}
                      onChange={(e) => setEditGoalAmount(e.target.value)}
                      style={{ width: 100 }}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={editGoalDate}
                      onChange={(e) => setEditGoalDate(e.target.value)}
                    />
                  </td>
                  <td className="money">{formatMoney(g.required_monthly_savings)}</td>
                  <td className="money">{formatMoney(g.projected_monthly_savings)}</td>
                  <GoalStatusCell goal={g} />
                  <td>
                    <button className="icon" onClick={saveEditGoal} title={t("goals.actions.save")}>
                      <FiCheck />
                    </button>{" "}
                    <button
                      className="secondary icon"
                      onClick={() => setEditingGoalId(null)}
                      title={t("goals.actions.cancel")}
                    >
                      <FiX />
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={g.id}>
                  <td>{g.name}</td>
                  <td className="money">{formatMoney(g.target_amount)}</td>
                  <td>{g.target_date}</td>
                  <td className="money">{formatMoney(g.required_monthly_savings)}</td>
                  <td className="money">{formatMoney(g.projected_monthly_savings)}</td>
                  <GoalStatusCell goal={g} />
                  <td>
                    <button
                      className="secondary icon"
                      onClick={() => startEditGoal(g)}
                      title={t("goals.actions.edit")}
                    >
                      <FiEdit2 />
                    </button>{" "}
                    <button
                      className="danger icon"
                      onClick={() => deleteGoal.mutate(g.id)}
                      title={t("goals.actions.remove")}
                    >
                      <FiTrash2 />
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>

        <NewGoalForm />
      </div>
    </div>
  );
}
