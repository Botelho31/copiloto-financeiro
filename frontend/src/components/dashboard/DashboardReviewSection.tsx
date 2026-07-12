import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiX } from "react-icons/fi";
import type { AppSettings, Category, ProjectionResult, Transaction } from "shared";
import { ColorSwatch } from "../ColorSwatch";
import { GroupedTransactionList } from "../GroupedTransactionList";
import { SortableTransactionTable } from "../SortableTransactionTable";
import { CategoryPie } from "./CategoryPie";
import {
  ANOMALY_MIN_TRAILING_AVG,
  ANOMALY_THRESHOLD_PERCENT,
  FALLBACK_CATEGORY_COLOR,
  REVIEW_LOOKBACK_MONTHS,
} from "../../config";
import { formatMoney } from "../../lib/format";
import type { Period } from "../../lib/period";

// Review mode's whole point is accountability — "did I stay in control,
// where exactly did it leak." Everything here (the verdict cards, the
// anomaly/biggest-hits breakdowns, the category pies, and the drilldown
// table underneath them) only ever gets populated from this section's own
// UI, so all of it — including `drilldown` — is scoped locally rather than
// living on the shared Dashboard shell.
export function DashboardReviewSection(props: {
  period: Period;
  cashflowBankTx: Transaction[];
  allCardTx: Transaction[];
  categoryColorByName: Map<string, string>;
  categoryIsCardBillPayment: Map<number, boolean>;
  categories: Category[] | undefined;
  settings: AppSettings | undefined;
  projections: ProjectionResult | undefined;
  cardAccounts: { id: string; name: string }[];
  cardSpendChartData: Record<string, string | number | Date>[];
  totalIn: number;
  totalOut: number;
  includeCardSpend: boolean;
  onIncludeCardSpendChange: (value: boolean) => void;
}) {
  const { t } = useTranslation(["dashboard", "common"]);
  const {
    period,
    cashflowBankTx,
    allCardTx,
    categoryColorByName,
    categoryIsCardBillPayment,
    categories,
    settings,
    projections,
    cardAccounts,
    cardSpendChartData,
    totalIn,
    totalOut,
    includeCardSpend,
  } = props;

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
    const now = new Date();
    if (now < period.start || now >= period.end) return null;
    return Math.ceil((period.end.getTime() - now.getTime()) / 86_400_000);
  }, [period]);

  // Category spikes say which bucket leaked; this says which specific
  // purchases — a month can leak through one big hit that never registers
  // as an anomaly because its category was already large. Same inclusion
  // rule as categoryBreakdown/drilldownTx so the numbers agree with the
  // pies below.
  const largestExpenses = useMemo(() => {
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
    <>
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
                    const selected = drilldown?.type === "DEBIT" && drilldown.category === cat.name;
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
                          <ColorSwatch
                            color={categoryColorByName.get(cat.name) ?? FALLBACK_CATEGORY_COLOR}
                          />
                          <span style={{ color: "var(--paper)", fontWeight: 600 }}>{cat.name}</span>
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
              <p className="muted">{t("review.noAnomalies", { months: REVIEW_LOOKBACK_MONTHS })}</p>
            )}
          </div>
          {largestExpenses.top.length > 0 && (
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
                  {largestExpenses.top.map((tx) => (
                    <tr key={tx.id}>
                      <td className="money" style={{ color: "var(--text-muted)" }}>
                        {String(new Date(tx.date).getDate()).padStart(2, "0")}
                      </td>
                      <td>{tx.description}</td>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <ColorSwatch
                            size={8}
                            color={
                              categoryColorByName.get(tx.category_name ?? "Uncategorized") ??
                              FALLBACK_CATEGORY_COLOR
                            }
                          />
                          {tx.category_name ?? "Uncategorized"}
                        </span>
                      </td>
                      <td className="money shortfall">{formatMoney(Math.abs(tx.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

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
              onChange={(e) => props.onIncludeCardSpendChange(e.target.checked)}
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
    </>
  );
}
