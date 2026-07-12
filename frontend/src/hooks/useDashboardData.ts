import { useMemo } from "react";
import { useAccounts } from "./useAccounts";
import { useCategories } from "./useCategories";
import { useInvestments } from "./useInvestments";
import { useProjections } from "./useProjections";
import { useSettings } from "./useSettings";
import { useTags } from "./useTags";
import { useEarliestTransactionDate, useTransactions } from "./useTransactions";
import { computeNetWorth } from "../lib/netWorth";
import {
  expectedBreakdown,
  expectedCardCharges,
  findProjectedMonth,
  sumIncomeExpense,
} from "../lib/dashboardProjection";
import { monthsInPeriod, parseIsoDate, toIsoDate, type Period } from "../lib/period";
import { DASHBOARD_PROJECTION_HORIZON_MONTHS, REVIEW_LOOKBACK_MONTHS } from "../config";

// Everything fetched or derived from account/transaction/projection data
// that's shared by two or more of the Dashboard's modes (or by the shell
// itself) lives here — the mode-exclusive computations (reviewVerdict,
// planningFlowData, topCategoriesOverTime, ...) stay local to their own
// section component instead, since dumping them in here too would just
// turn this hook into a second copy of the whole page.
export function useDashboardData(
  period: Period,
  dashboardMode: "trends" | "review" | "planning",
  tagId: number | undefined
) {
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
  const { data: projections } = useProjections(DASHBOARD_PROJECTION_HORIZON_MONTHS);
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
  // Review mode's reviewVerdict/categoryAnomalies need a trailing window
  // that predates period.start itself — without pulling those extra months
  // in here, they silently filter down to nothing (the fetch never
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

  // Browsing a future month on the Dashboard only ever shows real (usually
  // sparse — a pre-scheduled installment or two) transaction data. Planning
  // mode's job is answering "will I be okay, what can I still change" —
  // a headline projected net, committed vs assumed expenses (two different
  // confidence tiers, not one flat "future"), and how much discretionary
  // card room is left after known commitments. Computed here (not inside
  // DashboardPlanningSection) because the shell's own summary cards need
  // planningData.income/expense too, when planning mode is active.
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

  return {
    categories,
    investments,
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
  };
}
