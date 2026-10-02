import { useEffect, useMemo, useState } from "react";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PeriodPicker } from "../components/PeriodPicker";
import { SummaryCard } from "../components/SummaryCard";
import { DashboardPlanningSection } from "../components/dashboard/DashboardPlanningSection";
import { DashboardReviewSection } from "../components/dashboard/DashboardReviewSection";
import { DashboardTrendsSection } from "../components/dashboard/DashboardTrendsSection";
import { useDashboardData } from "../hooks/useDashboardData";
import { CARD_CHART_COLORS, FALLBACK_CATEGORY_COLOR } from "../config";
import { findProjectedMonth } from "../lib/dashboardProjection";
import { formatMoney, moneyTooltip } from "../lib/format";
import { periodFor, type Period } from "../lib/period";

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

// The Dashboard is really three different pages wearing the same shell
// (account summary cards, mode toggle, period picker, and the three shared
// charts below): trends (a range spanning multiple months — "is my
// financial life moving the right direction"), review (a single past or
// current month — "did I stay in control, where exactly did it leak"),
// and planning (a single future month — "will I be okay, what can I still
// change"). Each mode's own exclusive data and JSX live in their own
// section component (DashboardReviewSection/DashboardPlanningSection/
// DashboardTrendsSection); everything two or more modes (or this shell)
// need is computed once in useDashboardData instead.
export function DashboardPage() {
  const { t } = useTranslation(["dashboard", "common"]);
  const [period, setPeriod] = useState<Period>(() => periodFor("year"));
  const [tagId, setTagId] = useState<number | undefined>();
  const [includeCardSpend, setIncludeCardSpend] = useState(true);
  const [balanceOverTimeOpen, setBalanceOverTimeOpen] = useState(false);
  const [cardChartGrouping, setCardChartGrouping] = useState<"card" | "category">("card");

  function changePeriod(next: Period) {
    setPeriod(next);
  }

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

  const {
    categories,
    tags,
    settings,
    projections,
    allTimeStart,
    categoryColorByName,
    categoryIsCardBillPayment,
    cardBillPaymentCategoryName,
    cardAccounts,
    accountGroups,
    allCardTx,
    cashflowBankTx,
    totalIn,
    totalOut,
    chartData,
    cardSpendChartData,
    cardSpendChartDataWithExpectedBills,
    cardCategoryNames,
    cardCategorySpendByMonth,
    planningData,
  } = useDashboardData(period, dashboardMode, tagId);

  function handleBarClick(data: any) {
    const start = data?.payload?.start ?? data?.start;
    if (start) changePeriod(periodFor("month", new Date(start)));
  }

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
              className={dashboardMode === "trends" ? "active" : undefined}
              onClick={switchToTrends}
            >
              {t("modes.trends")}
            </button>
            <button
              type="button"
              className={dashboardMode === "review" ? "active" : undefined}
              onClick={switchToReview}
            >
              {t("modes.review")}
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
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
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

      {dashboardMode === "review" && (
        <DashboardReviewSection
          period={period}
          cashflowBankTx={cashflowBankTx}
          allCardTx={allCardTx}
          categoryColorByName={categoryColorByName}
          categoryIsCardBillPayment={categoryIsCardBillPayment}
          categories={categories}
          settings={settings}
          projections={projections}
          cardAccounts={cardAccounts}
          cardSpendChartData={cardSpendChartData}
          totalIn={totalIn}
          totalOut={totalOut}
          includeCardSpend={includeCardSpend}
          onIncludeCardSpendChange={setIncludeCardSpend}
        />
      )}

      {dashboardMode === "planning" && planningData && (
        <DashboardPlanningSection
          period={period}
          projections={projections}
          categoryColorByName={categoryColorByName}
          cardBillPaymentCategoryName={cardBillPaymentCategoryName}
          planningData={planningData}
          onBarClick={handleBarClick}
        />
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

      {dashboardMode === "trends" && (
        <DashboardTrendsSection
          period={period}
          cashflowBankTx={cashflowBankTx}
          allCardTx={allCardTx}
          includeCardSpend={includeCardSpend}
          categoryIsCardBillPayment={categoryIsCardBillPayment}
          categoryColorByName={categoryColorByName}
          projections={projections}
          onBarClick={handleBarClick}
        />
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
                      fill={CARD_CHART_COLORS[i % CARD_CHART_COLORS.length]}
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
    </div>
  );
}
