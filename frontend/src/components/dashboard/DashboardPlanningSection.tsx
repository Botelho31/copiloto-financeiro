import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ExpectedLine } from "../../lib/dashboardProjection";
import { expectedBreakdown, sumIncomeExpense } from "../../lib/dashboardProjection";
import { FALLBACK_CATEGORY_COLOR } from "../../config";
import { formatMoney, moneyTooltip } from "../../lib/format";
import type { Period } from "../../lib/period";
import type { ProjectionResult } from "shared";

export interface PlanningData {
  income: number;
  expense: number;
  net: number;
  incomeLines: ExpectedLine[];
  committedExpenseLines: ExpectedLine[];
  assumedExpenseLines: ExpectedLine[];
  cardGoal: number;
  knownCardCharges: number;
  cardRoomLeft: number;
}

// Planning mode's job is answering "will I be okay, what can I still
// change" for a future month — a headline projected net, committed vs.
// assumed expenses, discretionary card room, and (below that) how the
// months further out look. `planningData` itself is computed one level up
// (Dashboard.tsx's useDashboardData) since the shell's own summary cards
// need it too; everything derived only for this section's own charts lives
// here.
export function DashboardPlanningSection(props: {
  period: Period;
  projections: ProjectionResult | undefined;
  categoryColorByName: Map<string, string>;
  cardBillPaymentCategoryName: string;
  planningData: PlanningData;
  onBarClick: (data: any) => void;
}) {
  const { t } = useTranslation(["dashboard", "common"]);
  const {
    period,
    projections,
    categoryColorByName,
    cardBillPaymentCategoryName,
    planningData,
    onBarClick,
  } = props;

  const planningFlowData = useMemo(() => {
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
  // backend/API-ARCHITECTURE.md's R3) — no id cross-reference needed. Two
  // kinds of expense line here were never going to resolve to a real bill
  // category, since they aren't bills at all: the cardSpend goal/average is
  // a synthetic aggregate (kind "cardSpend"), and a debt's own repayment
  // line with no linked bill (kind "debt", category_name null). Bucket them
  // into the same categories those amounts already show up under elsewhere
  // in the app (the card bill payment is whichever category is flagged
  // is_card_bill_payment; a debt repayment gets its own "Debt Repayment"
  // category).
  const planningCategoryBreakdown = useMemo(() => {
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
    if (!projections) return [];
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
  }, [projections, period]);

  return (
    <>
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
                <BarChart data={planningCategoryBreakdown} layout="vertical" margin={{ right: 24 }}>
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

      {planningOutlookData.length > 1 && (
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
                  onClick={onBarClick}
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
    </>
  );
}
