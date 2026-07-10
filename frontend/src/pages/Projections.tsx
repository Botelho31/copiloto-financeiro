import { Fragment, type FormEvent, useEffect, useState } from "react";
import { FiCheck, FiChevronDown, FiChevronRight, FiEdit2, FiPlus, FiTrash2, FiX } from "react-icons/fi";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Debt, Goal, ProjectedMonth } from "shared";
import { PeriodPicker } from "../components/PeriodPicker";
import { SortableTh } from "../components/SortableTh";
import { SummaryCard } from "../components/SummaryCard";
import { useBills } from "../hooks/useBills";
import { useDebts } from "../hooks/useDebts";
import { useCreateGoal, useDeleteGoal, useGoals, useUpdateGoal } from "../hooks/useGoals";
import { useProjections, useWhatIfProjection } from "../hooks/useProjections";
import { useSettings, useUpdateSettings } from "../hooks/useSettings";
import { useSortableTable } from "../hooks/useSortableTable";
import { formatMoney } from "../lib/format";
import { periodFor, type Granularity, type Period } from "../lib/period";

// Projections only make sense as a horizon length, not a date range to
// browse — "custom" is excluded from the picker below, so that entry is
// unreachable, but every Granularity key must be present for TS.
const GRANULARITY_TO_HORIZON_MONTHS: Record<Granularity, number> = {
  month: 1,
  quarter: 3,
  semester: 6,
  year: 12,
  custom: 6,
};

// Brazil's Selic rate as of the June 2026 Copom cut — a reasonable default
// for idle-cash interest, fully editable below since real-world rates move.
const DEFAULT_INTEREST_RATE_ANNUAL_PERCENT = 14.25;

const PROJECTION_GRANULARITIES: Granularity[] = ["month", "quarter", "semester", "year"];

// Same palette the Dashboard uses for per-card bars — reused here so a
// goal's amount line and its date marker read as one color, and multiple
// goals don't all blur into the same gold line.
const GOAL_COLORS = ["#b5542d", "#5f7fbf", "#8c6a9c", "#4a9c8f", "#c9a227"];

const LINE_KIND_LABEL: Record<"bill" | "debt" | "interest" | "cardSpend", string> = {
  bill: "Future bill",
  debt: "Debt",
  interest: "Interest",
  cardSpend: "Card spend",
};

function moneyTooltip(value: any): string {
  return formatMoney(Number(value));
}

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
  payload?: { name?: string; value?: number; color?: string; dataKey?: string }[];
  debtEndMarkers: { id: number; name: string; projected_finish_date: string }[];
}) {
  if (!props.active || !props.payload || props.payload.length === 0) return null;
  const finishing = props.debtEndMarkers.filter((d) => d.projected_finish_date.slice(0, 7) === props.label);
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
      {finishing.length > 0 && (
        <p className="recharts-tooltip-item" style={{ margin: "4px 0 0", color: "var(--gold)", fontWeight: 600 }}>
          {finishing.map((d) => `${d.name} pays off`).join(", ")}
        </p>
      )}
    </div>
  );
}

function ScenarioBadge() {
  return (
    <span
      className="badge"
      style={{ color: "var(--gold)", borderColor: "var(--gold)", fontFamily: "var(--font-sans)", fontWeight: 500 }}
    >
      What-if scenario
    </span>
  );
}

function GoalStatusCell(props: { goal: Goal }) {
  const g = props.goal;
  const margin = g.projected_monthly_savings - g.required_monthly_savings;
  const ratio =
    g.required_monthly_savings > 0
      ? Math.max(0, Math.min(1, g.projected_monthly_savings / g.required_monthly_savings))
      : 1;
  return (
    <td>
      <span className={g.on_track ? "gain" : "shortfall"}>{g.on_track ? "On track" : "Behind"}</span>
      <div style={{ width: 90, height: 4, background: "var(--rule)", borderRadius: 2, margin: "6px 0 4px" }}>
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
        {formatMoney(Math.abs(margin))}/mo {g.on_track ? "to spare" : "short"}
      </span>
    </td>
  );
}

function MonthlyBreakdownTable(props: { months: ProjectedMonth[] }) {
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
          <SortableTh label="Month" sortKey="label" activeKey={monthSortKey} direction={monthSortDirection} onSort={toggleMonthSort} />
          <SortableTh label="Net" sortKey="net" activeKey={monthSortKey} direction={monthSortDirection} onSort={toggleMonthSort} />
          <SortableTh label="Balance" sortKey="balance" activeKey={monthSortKey} direction={monthSortDirection} onSort={toggleMonthSort} />
          <th />
        </tr>
      </thead>
      <tbody>
        {sortedMonths.map((m) => (
          <Fragment key={m.monthIndex}>
            <tr>
              <td>{m.label}</td>
              <td className={m.net < 0 ? "money shortfall" : "money"}>{formatMoney(m.net)}</td>
              <td className={m.shortfall ? "money shortfall" : "money"}>{formatMoney(m.balance)}</td>
              <td>
                <button
                  className="link-button"
                  onClick={() => setExpanded((e) => (e === m.monthIndex ? null : m.monthIndex))}
                >
                  {expanded === m.monthIndex ? <FiChevronDown /> : <FiChevronRight />} Lines
                </button>
              </td>
            </tr>
            {expanded === m.monthIndex && (
              <tr>
                <td colSpan={4} style={{ paddingTop: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <SortableTh label="Line item" sortKey="name" activeKey={lineSortKey} direction={lineSortDirection} onSort={toggleLineSort} />
                        <th>Kind</th>
                        <SortableTh label="Amount" sortKey="amount" activeKey={lineSortKey} direction={lineSortDirection} onSort={toggleLineSort} />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedLines.map((line) => (
                        <tr key={line.id}>
                          <td>{line.name}</td>
                          <td className="muted" style={{ whiteSpace: "nowrap" }}>
                            {LINE_KIND_LABEL[line.kind]}
                            {line.kind === "cardSpend" && (
                              <span
                                className="badge"
                                style={{ marginLeft: 8 }}
                                title="Estimated from your 3-month average / spending goal — not a committed charge"
                              >
                                assumed
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
  const months = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  return Math.max(1, months);
}

export function ProjectionsPage() {
  const [period, setPeriod] = useState<Period>(() => periodFor("year"));
  // A goal's own date can fall well outside any fixed granularity step —
  // this overrides the granularity-derived horizon entirely rather than
  // trying to fit it into month/quarter/semester/year buckets.
  const [horizonOverride, setHorizonOverride] = useState<{ months: number; name: string } | null>(null);
  const horizonMonths = horizonOverride?.months ?? GRANULARITY_TO_HORIZON_MONTHS[period.granularity];

  const { data: baseline } = useProjections(horizonMonths);
  const { data: bills } = useBills();
  const { data: debts } = useDebts();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const whatIf = useWhatIfProjection();

  const [billAmounts, setBillAmounts] = useState<Record<number, number>>({});
  const [discretionaryDeltaPercent, setDiscretionaryDeltaPercent] = useState(0);
  const [interestRateAnnualPercent, setInterestRateAnnualPercent] = useState(
    DEFAULT_INTEREST_RATE_ANNUAL_PERCENT
  );
  const [cardSpendGoal, setCardSpendGoal] = useState("");
  const [cardSpendGoalTouched, setCardSpendGoalTouched] = useState(false);

  // Prefill from the persisted global goal once it loads — but only until
  // the user actually touches the field, so an in-progress edit is never
  // clobbered by a background refetch.
  useEffect(() => {
    if (!cardSpendGoalTouched && settings?.cardSpendGoal != null) {
      setCardSpendGoal(String(settings.cardSpendGoal));
    }
  }, [settings, cardSpendGoalTouched]);

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
  const balanceChartData = months.map((m, i) => ({
    ...m,
    baselineBalance: baselineMonths[i]?.balance ?? null,
  }));

  const [breakdownOpen, setBreakdownOpen] = useState(true);

  const { data: goals } = useGoals();
  const goalCount = (goals ?? []).length;
  const goalsOnTrack = (goals ?? []).filter((g) => g.on_track).length;
  // A debt's own projected finish date — the same server-computed date the
  // Debts page's own "Finish date" stat shows (see projected_finish_date,
  // computeProjectedFinishDate in backend/src/routes/debts.ts). Marked on the
  // balance chart below as a gold dot on the month it pays off (hover for
  // which debt), not a vertical line — several debts finishing close together
  // would otherwise stack their labels on top of each other. This is NOT
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
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();
  const [goalName, setGoalName] = useState("");
  const [goalAmount, setGoalAmount] = useState("");
  const [goalDate, setGoalDate] = useState("");
  const [editingGoalId, setEditingGoalId] = useState<number | null>(null);
  const [editGoalName, setEditGoalName] = useState("");
  const [editGoalAmount, setEditGoalAmount] = useState("");
  const [editGoalDate, setEditGoalDate] = useState("");

  function startEditGoal(g: { id: number; name: string; target_amount: number; target_date: string }) {
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
        input: { name: editGoalName, targetAmount: Number(editGoalAmount), targetDate: editGoalDate },
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

  function submitGoal(e: FormEvent) {
    e.preventDefault();
    if (!goalName || !goalAmount || !goalDate) return;
    createGoal.mutate(
      { name: goalName, targetAmount: Number(goalAmount), targetDate: goalDate },
      {
        onSuccess: () => {
          setGoalName("");
          setGoalAmount("");
          setGoalDate("");
        },
      }
    );
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
                title="Set the horizon to span until your furthest-out goal or debt end date"
              >
                Span until latest goal/debt
              </button>
            )}
          </div>
          {horizonOverride && (
            <span className="muted" style={{ fontSize: 13 }}>
              Spanning {horizonMonths} months, until "{horizonOverride.name}"
            </span>
          )}
          {scenarioActive && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ScenarioBadge />
              <button className="secondary" onClick={resetWhatIf}>
                Reset to baseline
              </button>
            </div>
          )}
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
          <SummaryCard
            label={`Balance in ${lastMonth?.label ?? "—"}`}
            value={formatMoney(endBalance)}
            tone={!lastMonth ? undefined : endBalance < 0 ? "bad" : endBalance >= startingBalance ? "good" : undefined}
            caption={
              `${endBalance - startingBalance >= 0 ? "+" : ""}${formatMoney(endBalance - startingBalance)} vs today` +
              (scenarioActive && baselineEndBalance != null
                ? ` · baseline ${formatMoney(baselineEndBalance)}`
                : "")
            }
          />
          <SummaryCard
            label="Avg net savings / month"
            value={formatMoney(avgNet)}
            tone={months.length === 0 ? undefined : avgNet >= 0 ? "good" : "bad"}
            caption={`over the next ${months.length} month${months.length === 1 ? "" : "s"}`}
          />
          <SummaryCard
            label="First shortfall"
            value={firstShortfall?.label ?? (months.length > 0 ? "None" : "—")}
            tone={months.length === 0 ? undefined : firstShortfall ? "bad" : "good"}
            caption={
              firstShortfall
                ? "balance goes negative this month"
                : "balance stays above zero for the whole horizon"
            }
          />
          <SummaryCard
            label="Goals on track"
            value={goalCount === 0 ? "—" : `${goalsOnTrack} of ${goalCount}`}
            tone={goalCount === 0 ? undefined : goalsOnTrack === goalCount ? "good" : "bad"}
            caption={
              goalCount === 0
                ? "no savings goals yet — add one below"
                : goalsOnTrack === goalCount
                  ? "projected savings cover every goal"
                  : "details in the Goals card below"
            }
          />
        </div>
      </div>

      <div className="card">
        <h2 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          Projected balance
          {scenarioActive && <ScenarioBadge />}
        </h2>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={balanceChartData}>
              <XAxis dataKey="label" stroke="var(--text-muted)" />
              <YAxis stroke="var(--text-muted)" />
              <Tooltip content={<BalanceTooltip debtEndMarkers={debtEndMarkers} />} />
              {showBaselineOverlay && <Legend />}
              {showBaselineOverlay && (
                <Line
                  type="monotone"
                  dataKey="baselineBalance"
                  name="Baseline"
                  stroke="var(--text-muted)"
                  strokeDasharray="6 4"
                  dot={false}
                />
              )}
              <Line
                type="monotone"
                dataKey="balance"
                name={showBaselineOverlay ? "What-if scenario" : "Balance"}
                stroke="var(--accent)"
                strokeWidth={2}
                dot={(props: any) => {
                  // A debt paying off this month gets its own gold dot instead
                  // of a dotted vertical line — several debts finishing close
                  // together used to stack their labels on top of each other.
                  // Which debt(s) shows in BalanceTooltip above on hover, not
                  // a native SVG title on the dot itself — recharts' own
                  // hover-tracking overlay sits on top of a custom dot shape
                  // and would swallow the pointer before a nested title ever
                  // saw it.
                  const finishing = debtEndMarkers.some(
                    (d) => d.projected_finish_date.slice(0, 7) === props.payload.label
                  );
                  return (
                    <circle
                      key={props.payload.monthIndex}
                      cx={props.cx}
                      cy={props.cy}
                      r={finishing ? 5 : 4}
                      fill={finishing ? "var(--gold)" : props.payload.shortfall ? "var(--danger)" : "var(--accent)"}
                    />
                  );
                }}
              />
              {hasShortfall && <ReferenceLine y={0} stroke="var(--danger)" strokeOpacity={0.5} />}
              {(goals ?? []).map((g, i) => {
                const color = GOAL_COLORS[i % GOAL_COLORS.length];
                // target_date is "YYYY-MM-DD"; month labels are "YYYY-MM" —
                // only draw the date marker if this goal's month is actually
                // in view (it can fall outside the current horizon).
                const goalLabel = g.target_date.slice(0, 7);
                const goalInView = months.some((m) => m.label === goalLabel);
                const labelProps = {
                  value: `${g.name} (${formatMoney(g.target_amount)})`,
                  position: "insideTopLeft" as const,
                  fill: color,
                  fontSize: 11,
                };
                // An L-bracket (left edge → goal, bottom → goal) reads as
                // "here's the goal" much more clearly than two lines that run
                // the full width/height of the chart regardless of where the
                // goal actually falls — once the goal itself is past, there's
                // nothing left for the line to mark. Only possible when the
                // goal's month is actually plotted; otherwise fall back to a
                // full-width line, since there's no in-view x to bracket to.
                if (goalInView && months[0]) {
                  return (
                    <Fragment key={g.id}>
                      <ReferenceLine
                        segment={[
                          { x: months[0].label, y: g.target_amount },
                          { x: goalLabel, y: g.target_amount },
                        ]}
                        stroke={color}
                        strokeOpacity={0.65}
                        strokeDasharray="4 4"
                        label={labelProps}
                      />
                      <ReferenceLine
                        segment={[
                          { x: goalLabel, y: 0 },
                          { x: goalLabel, y: g.target_amount },
                        ]}
                        stroke={color}
                        strokeOpacity={0.65}
                        strokeDasharray="4 4"
                      />
                    </Fragment>
                  );
                }
                return (
                  <ReferenceLine
                    key={g.id}
                    y={g.target_amount}
                    stroke={color}
                    strokeOpacity={0.65}
                    strokeDasharray="4 4"
                    label={labelProps}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h2 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          Projected savings per month
          {scenarioActive && <ScenarioBadge />}
        </h2>
        <p className="muted">
          Built from solid things only: confirmed bills (income + expense), each active debt's own
          fixed installment schedule (skipped if its payment history is too irregular to call a real
          cadence), and a 3-month average of actual credit card spend — no generic bank-transaction
          averaging, so a one-off transfer can't smear itself across every future month.
        </p>
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginBottom: 16 }}
        >
          <SummaryCard label="Starting balance" value={formatMoney(result?.startingBalance ?? 0)} />
          <SummaryCard
            label="Card spend baseline (3mo avg)"
            value={formatMoney(result?.cardSpendActualAverage ?? 0)}
            tone="negative"
          />
          <div className="summary-card">
            <div className="label">Monthly card spending goal</div>
            <input
              type="number"
              step="0.01"
              placeholder={formatMoney(result?.cardSpendActualAverage ?? 0)}
              value={cardSpendGoal}
              onChange={(e) => {
                const value = e.target.value;
                setCardSpendGoalTouched(true);
                setCardSpendGoal(value);
                recompute(billAmounts, discretionaryDeltaPercent, interestRateAnnualPercent, value);
              }}
              onBlur={(e) => {
                const value = e.target.value;
                updateSettings.mutate({ cardSpendGoal: value === "" ? null : Number(value) });
              }}
              style={{ width: "100%", marginTop: 8 }}
            />
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {cardSpendGoal === ""
                ? "Using the 3-month average — type a number to set a standing goal (shown on the Dashboard too)"
                : `Saved as your standing goal: ${formatMoney(Number(cardSpendGoal))}/mo`}
            </div>
          </div>
        </div>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={months}>
              <XAxis dataKey="label" stroke="var(--text-muted)" />
              <YAxis stroke="var(--text-muted)" />
              <Tooltip formatter={moneyTooltip} />
              <Bar dataKey="net" name="Net savings" fill="var(--accent)">
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
          {breakdownOpen ? <FiChevronDown /> : <FiChevronRight />} Monthly breakdown
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
          <h2 style={{ margin: 0 }}>What-if</h2>
          {scenarioActive && (
            <button className="secondary" onClick={resetWhatIf}>
              Reset to baseline
            </button>
          )}
        </div>
        <p className="muted" style={{ marginBottom: 16 }}>
          Every change here recomputes the charts and headline numbers above, live — the gold badge
          marks them as a hypothetical, with your real baseline kept as the dashed line for
          comparison. Nothing here is saved; reset or switch the horizon to go back.
        </p>
        <label>
          Discretionary spending adjustment: {discretionaryDeltaPercent}%
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
          Annual interest rate on idle cash: {interestRateAnnualPercent}%{" "}
          <span className="muted">(defaults to Brazil's Selic rate — edit if it's moved)</span>
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
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 24, alignItems: "start", marginTop: 16 }}
        >
          <div>
            <h3 style={{ marginTop: 0 }}>Income</h3>
            <table>
              <thead>
                <tr>
                  <SortableTh label="Bill" sortKey="name" activeKey={incomeSortKey} direction={incomeSortDirection} onSort={toggleIncomeSort} />
                  <SortableTh label="Expected" sortKey="expected" activeKey={incomeSortKey} direction={incomeSortDirection} onSort={toggleIncomeSort} />
                  <th title="Charged to a credit card — excluded from the projection since it's already covered by the card spending goal/average">
                    Card?
                  </th>
                  <th>Override</th>
                </tr>
              </thead>
              <tbody>
                {sortedIncomeBills.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td className="money" style={{ color: "var(--accent)" }}>
                      +{formatMoney(b.expected_amount)}
                    </td>
                    <td>{b.is_card_expense ? <FiCheck /> : null}</td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        placeholder={String(b.expected_amount)}
                        value={billAmounts[b.id] ?? ""}
                        style={{ width: 110 }}
                        disabled={b.is_card_expense}
                        title={b.is_card_expense ? "Charged to card — not part of the projection, so overriding has no effect" : undefined}
                        onChange={(e) => {
                          const value = e.target.value ? Number(e.target.value) : undefined;
                          const next = { ...billAmounts };
                          if (value === undefined) delete next[b.id];
                          else next[b.id] = value;
                          setBillAmounts(next);
                          recompute(next, discretionaryDeltaPercent, interestRateAnnualPercent, cardSpendGoal);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

          </div>
          <div>
            <h3 style={{ marginTop: 0 }}>Expenses</h3>
            <table>
              <thead>
                <tr>
                  <SortableTh label="Bill" sortKey="name" activeKey={expenseSortKey} direction={expenseSortDirection} onSort={toggleExpenseSort} />
                  <SortableTh label="Expected" sortKey="expected" activeKey={expenseSortKey} direction={expenseSortDirection} onSort={toggleExpenseSort} />
                  <th title="Charged to a credit card — excluded from the projection since it's already covered by the card spending goal/average">
                    Card?
                  </th>
                  <th>Override</th>
                </tr>
              </thead>
              <tbody>
                {sortedExpenseBills.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td className="money shortfall">-{formatMoney(b.expected_amount)}</td>
                    <td>{b.is_card_expense ? <FiCheck /> : null}</td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        placeholder={String(b.expected_amount)}
                        value={billAmounts[b.id] ?? ""}
                        style={{ width: 110 }}
                        disabled={b.is_card_expense}
                        title={b.is_card_expense ? "Charged to card — not part of the projection, so overriding has no effect" : undefined}
                        onChange={(e) => {
                          const value = e.target.value ? Number(e.target.value) : undefined;
                          const next = { ...billAmounts };
                          if (value === undefined) delete next[b.id];
                          else next[b.id] = value;
                          setBillAmounts(next);
                          recompute(next, discretionaryDeltaPercent, interestRateAnnualPercent, cardSpendGoal);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Goals</h2>
        <p className="muted">
          A target amount by a date, checked against your projected monthly savings rate.
        </p>
        <table>
          <thead>
            <tr>
              <SortableTh label="Goal" sortKey="name" activeKey={goalSortKey} direction={goalSortDirection} onSort={toggleGoalSort} />
              <SortableTh label="Target" sortKey="target" activeKey={goalSortKey} direction={goalSortDirection} onSort={toggleGoalSort} />
              <SortableTh label="By" sortKey="by" activeKey={goalSortKey} direction={goalSortDirection} onSort={toggleGoalSort} />
              <SortableTh label="Need/mo" sortKey="needPerMonth" activeKey={goalSortKey} direction={goalSortDirection} onSort={toggleGoalSort} />
              <SortableTh label="Projected/mo" sortKey="projectedPerMonth" activeKey={goalSortKey} direction={goalSortDirection} onSort={toggleGoalSort} />
              <SortableTh label="On track?" sortKey="onTrack" activeKey={goalSortKey} direction={goalSortDirection} onSort={toggleGoalSort} />
              <th />
            </tr>
          </thead>
          <tbody>
            {sortedGoals.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No goals yet — add one below to see whether your projected savings can reach it.
                </td>
              </tr>
            )}
            {sortedGoals.map((g) =>
              editingGoalId === g.id ? (
                <tr key={g.id}>
                  <td>
                    <input type="text" value={editGoalName} onChange={(e) => setEditGoalName(e.target.value)} />
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
                    <input type="date" value={editGoalDate} onChange={(e) => setEditGoalDate(e.target.value)} />
                  </td>
                  <td className="money">{formatMoney(g.required_monthly_savings)}</td>
                  <td className="money">{formatMoney(g.projected_monthly_savings)}</td>
                  <GoalStatusCell goal={g} />
                  <td>
                    <button className="icon" onClick={saveEditGoal} title="Save">
                      <FiCheck />
                    </button>{" "}
                    <button className="secondary icon" onClick={() => setEditingGoalId(null)} title="Cancel">
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
                    <button className="secondary icon" onClick={() => startEditGoal(g)} title="Edit">
                      <FiEdit2 />
                    </button>{" "}
                    <button className="danger icon" onClick={() => deleteGoal.mutate(g.id)} title="Remove">
                      <FiTrash2 />
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>

        <form
          onSubmit={submitGoal}
          className="grid"
          style={{ gridTemplateColumns: "repeat(4, auto)", alignItems: "end", marginTop: 16 }}
        >
          <label>
            Name
            <input type="text" value={goalName} onChange={(e) => setGoalName(e.target.value)} required />
          </label>
          <label>
            Target amount
            <input
              type="number"
              step="0.01"
              value={goalAmount}
              onChange={(e) => setGoalAmount(e.target.value)}
              required
            />
          </label>
          <label>
            Target date
            <input type="date" value={goalDate} onChange={(e) => setGoalDate(e.target.value)} required />
          </label>
          <button type="submit">
            <FiPlus /> Add goal
          </button>
        </form>
      </div>
    </div>
  );
}
