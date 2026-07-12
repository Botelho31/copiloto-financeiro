import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ProjectionResult, Transaction } from "shared";
import { FALLBACK_CATEGORY_COLOR, TOP_CATEGORY_COUNT } from "../../config";
import { findProjectedMonth } from "../../lib/dashboardProjection";
import { moneyTooltip } from "../../lib/format";
import { monthsInPeriod, type Period } from "../../lib/period";

// Trends mode's answer to "is spending creeping up in some category" — a
// static pie can't show that, only a trend over time can.
export function DashboardTrendsSection(props: {
  period: Period;
  cashflowBankTx: Transaction[];
  allCardTx: Transaction[];
  includeCardSpend: boolean;
  categoryIsCardBillPayment: Map<number, boolean>;
  categoryColorByName: Map<string, string>;
  projections: ProjectionResult | undefined;
  onBarClick: (data: any) => void;
}) {
  const { t } = useTranslation("dashboard");
  const {
    period,
    cashflowBankTx,
    allCardTx,
    includeCardSpend,
    categoryIsCardBillPayment,
    categoryColorByName,
    projections,
    onBarClick,
  } = props;

  const [hiddenTrendCategories, setHiddenTrendCategories] = useState<Set<string>>(new Set());

  function toggleTrendCategory(name: string) {
    setHiddenTrendCategories((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // Same merge rule as the review-mode category breakdown (bank spend +
  // card spend, minus the bank-side card bill payment to avoid
  // double-counting), just bucketed by month and narrowed to whichever
  // categories actually dominate the period.
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
      // it to — bucketed as "Debt Repayment" (matching the review-mode
      // breakdown's convention) rather than silently dropped.
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
  }, [period, cashflowBankTx, allCardTx, includeCardSpend, categoryIsCardBillPayment, projections]);

  if (topCategoriesOverTime.topNames.length === 0) return null;

  return (
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
                    onClick={() => onBarClick(props)}
                  />
                )}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
