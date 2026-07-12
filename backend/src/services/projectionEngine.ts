import type { BillOverride, ProjectedMonth, ProjectionResult } from "shared";
import { billAppliesToMonth, monthlyEquivalentAmount, pricePayment } from "shared";
import { config } from "../config";
import { db } from "../db";
import { listDebts } from "./debts";
import { getSettings } from "../routes/settings";

const DEFAULT_HORIZON_MONTHS = 6;
const BASELINE_LOOKBACK_MONTHS = 3;

// Brazil's Selic policy rate, as of the June 2026 Copom cut (source: BCB /
// Bloomberg coverage at the time this default was set) — a reasonable stand-in
// for what idle cash could earn (e.g. in a CDI-linked account), applied here
// as compounding interest on the projected balance. Real-world rates move;
// this is just the default and is fully overridable per request.
const DEFAULT_INTEREST_RATE_ANNUAL_PERCENT = 14.25;

type Cadence = "weekly" | "monthly" | "quarterly" | "yearly" | "once";

interface BillForProjection {
  id: number;
  name: string;
  expectedAmount: number;
  cadence: Cadence;
  nextDueDate: string | null;
  recurrenceStartDate: string | null;
  recurrenceEndDate: string | null;
  isIncome: boolean;
  categoryName: string | null;
}

export type { BillOverride, ProjectedMonth, ProjectionResult };

export interface ProjectionOptions {
  horizonMonths?: number;
  billOverrides?: BillOverride[];
  /** Percent change applied to the discretionary expense baseline, e.g. -20 to cut it by 20%. */
  discretionaryDeltaPercent?: number;
  /** Annual rate applied as compounding monthly interest on the projected balance. Defaults to the current Selic rate. */
  interestRateAnnualPercent?: number;
  /** Replaces the computed 3-month card-spend average with a fixed target — a spending goal rather than a historical fact. */
  cardSpendGoal?: number;
  /** null (default) = Household: every person's accounts/bills/debts combined. */
  userId?: number | null;
}

// Only BANK-type accounts (checking/savings) represent liquid cash. A CREDIT
// account's `balance` is the amount owed on the card — a liability, not cash
// on hand — so it must not be pooled into the projected starting balance.
export function currentBalance(userId: number | null = null): number {
  const userCondition = userId != null ? "AND user_id = ?" : "";
  const row = db
    .query(
      `SELECT COALESCE(SUM(balance), 0) as total FROM accounts WHERE type = 'BANK' ${userCondition}`
    )
    .get(...(userId != null ? [userId] : [])) as { total: number };
  return row.total;
}

// What's already owed across every card right now — a real, concrete number
// (unlike the average/goal, which is a recurring assumption about ongoing
// spending). It's what will actually come due on the very next bill, so it
// grounds the first projected month; a monthly average has no business
// standing in for a debt that already exists.
//
// Pluggy's reported balance for a credit account isn't just "what's due on
// the next bill" — it includes every already-committed future installment
// (e.g. an Airbnb stay split 6x shows its remaining 4 installments as
// PENDING transactions dated months out, and those are folded into the
// balance). Counting the whole thing as "next month's bill" overstates it —
// an installment due in December isn't coming due in August. Subtract out
// anything dated beyond next month so this reflects only what's actually
// coming due on the very next statement.
export function currentCardBalance(userId: number | null = null): number {
  const userCondition = userId != null ? "AND user_id = ?" : "";
  const totalRow = db
    .query(
      `SELECT COALESCE(SUM(balance), 0) as total FROM accounts WHERE type = 'CREDIT' ${userCondition}`
    )
    .get(...(userId != null ? [userId] : [])) as { total: number };

  const now = new Date();
  const dueAfterNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 1)
    .toISOString()
    .slice(0, 10);
  const notYetDueUserCondition = userId != null ? "AND a.user_id = ?" : "";
  const notYetDueRow = db
    .query(
      `SELECT COALESCE(SUM(t.amount), 0) as total
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE a.type = 'CREDIT' AND t.type = 'DEBIT' AND t.date >= ? ${notYetDueUserCondition}`
    )
    .get(...(userId != null ? [dueAfterNextMonth, userId] : [dueAfterNextMonth])) as {
    total: number;
  };

  return totalRow.total - notYetDueRow.total;
}

// Bills flagged is_card_expense are excluded entirely — that spend gets
// charged to a credit card, so it's already absorbed into the card-spend
// goal/average line rather than being additional spend on top of it. They
// still exist as trackable bills (visible, editable, deletable on the Bills
// page); the flag just keeps the projection from double-counting them.
function activeConfirmedBills(userId: number | null): BillForProjection[] {
  const userCondition = userId != null ? "AND b.user_id = ?" : "";
  const rows = db
    .query(
      `SELECT b.id, b.name, b.expected_amount, b.cadence, b.next_due_date,
              b.recurrence_start_date, b.recurrence_end_date, c.kind as category_kind, c.name as category_name
       FROM recurring_bills b
       LEFT JOIN categories c ON c.id = b.category_id
       WHERE b.confirmed = 1 AND b.active = 1 AND b.is_card_expense = 0 ${userCondition}`
    )
    .all(...(userId != null ? [userId] : [])) as {
    id: number;
    name: string;
    expected_amount: number;
    cadence: string;
    next_due_date: string | null;
    recurrence_start_date: string | null;
    recurrence_end_date: string | null;
    category_kind: string | null;
    category_name: string | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    expectedAmount: r.expected_amount,
    cadence: r.cadence as Cadence,
    nextDueDate: r.next_due_date,
    recurrenceStartDate: r.recurrence_start_date,
    recurrenceEndDate: r.recurrence_end_date,
    isIncome: r.category_kind === "income",
    categoryName: r.category_name,
  }));
}

// The mirror image of activeConfirmedBills — is_card_expense bills, which
// are excluded from net/billLines entirely so as not to double up against
// the card-spend goal/average. They're still worth surfacing separately
// wherever the point is specifically "what's expected to hit a card this
// month" (e.g. the Dashboard's per-card chart), just not folded into the
// overall cashflow numbers.
function cardExpenseBills(userId: number | null): BillForProjection[] {
  const userCondition = userId != null ? "AND b.user_id = ?" : "";
  const rows = db
    .query(
      `SELECT b.id, b.name, b.expected_amount, b.cadence, b.next_due_date,
              b.recurrence_start_date, b.recurrence_end_date, c.name as category_name
       FROM recurring_bills b
       LEFT JOIN categories c ON c.id = b.category_id
       WHERE b.confirmed = 1 AND b.active = 1 AND b.is_card_expense = 1 ${userCondition}`
    )
    .all(...(userId != null ? [userId] : [])) as {
    id: number;
    name: string;
    expected_amount: number;
    cadence: string;
    next_due_date: string | null;
    recurrence_start_date: string | null;
    recurrence_end_date: string | null;
    category_name: string | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    expectedAmount: r.expected_amount,
    cadence: r.cadence as Cadence,
    nextDueDate: r.next_due_date,
    recurrenceStartDate: r.recurrence_start_date,
    recurrenceEndDate: r.recurrence_end_date,
    isIncome: false,
    categoryName: r.category_name,
  }));
}

// Bank-transaction averaging was the old approach here, and it's exactly
// wrong: a one-off transfer (a company repayment, a broker move, a tax
// payment) lands in the 3-month window and gets smeared across every future
// month as if it recurs. Projections now rest on only "solid" things:
// confirmed bills (income + expense), debts' own known remaining schedule,
// and a 3-month average of actual credit card spend (a much more stable
// proxy for discretionary spending than raw bank-transaction noise, since
// it's just charges — no transfers, no loan disbursements, no one-off wires).
function cardSpendBaseline(userId: number | null): number {
  const now = new Date();
  const since = new Date();
  since.setMonth(since.getMonth() - BASELINE_LOOKBACK_MONTHS);
  const sinceStr = since.toISOString().slice(0, 10);
  const nowStr = now.toISOString().slice(0, 10);
  const userCondition = userId != null ? "AND a.user_id = ?" : "";

  // Pluggy pre-registers future installments (e.g. an Airbnb booking split
  // 6x) as PENDING transactions dated when they'll actually be charged —
  // without an upper bound, those future-dated rows leak into what's
  // supposed to be a backward-looking "last 3 months" average. Categories
  // flagged excludes_from_cashflow (e.g. reimbursed spend that never was
  // really "your" money) are left out for the same reason transfers are.
  //
  // Transactions already matched to a confirmed, active bill are excluded
  // too — those recur as their own explicit line item elsewhere in this
  // computation, so leaving them in this average as well would count them
  // twice (once smeared into the average, once again by name).
  const row = db
    .query(
      `SELECT COALESCE(SUM(t.amount), 0) as total
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE a.type = 'CREDIT' AND t.type = 'DEBIT' AND t.date >= ? AND t.date < ?
         AND COALESCE(c.excludes_from_cashflow, 0) = 0
         AND t.id NOT IN (
           SELECT m.transaction_id
           FROM recurring_bill_matches m
           JOIN recurring_bills b ON b.id = m.recurring_bill_id
           WHERE b.confirmed = 1 AND b.active = 1
         )
         ${userCondition}`
    )
    .get(...(userId != null ? [sinceStr, nowStr, userId] : [sinceStr, nowStr])) as {
    total: number;
  };

  return row.total / BASELINE_LOOKBACK_MONTHS;
}

interface DebtProjectionLine {
  debtId: number;
  name: string;
  direction: "owed_by_me" | "owed_to_me";
  schedule:
    | {
        // History-based: a flat amount inferred from real past payments.
        // Shares the debt's remainingBalance cap with any other line on the
        // same debt (a linked bill can co-exist with this), tracked via the
        // caller's cumulative paidSoFar rather than an independent month count.
        kind: "flat";
        monthlyAmount: number;
        remainingBalance: number;
      }
    | {
        // Formula-based: computed fresh for any calendar month from the
        // loan's own terms — doesn't need payment history, so it works for
        // a future loan (e.g. a mortgage that hasn't closed yet) just as
        // well as one already underway. Shares the debt's remainingBalance
        // cap too — a linked extra-amortization bill can pay the balance off
        // faster than the plain schedule alone, ending this line early.
        kind: "loan";
        loanType: "price" | "sac";
        principal: number;
        monthlyRatePercent: number;
        startDate: string;
        termMonths: number;
        remainingBalance: number;
      }
    | {
        // Bill-driven: one of possibly several bills explicitly linked to
        // this debt, each keeping its own amount/cadence (full recurrence-
        // bounds support, not a flat guess). Every line on the same debt
        // shares one remainingBalance cap, so multiple bills (or a bill plus
        // the automatic heuristic) can't collectively overpay it.
        kind: "bill";
        bill: BillForProjection;
        remainingBalance: number;
      };
}

// Signed amount for a debt line in a given calendar month (plus, for a
// formal loan, how much of that amount is interest rather than principal),
// or null if the debt doesn't apply that month (not started yet, already
// paid off, or the debt's shared remaining balance is exhausted). paidSoFar
// is the sum *every* line on this same debt has already contributed in
// earlier projected months (and earlier lines this same month) — flat and
// bill schedules both stop once it reaches the debt's real remaining
// balance, since several lines can be paying down the same debt at once.
function debtLineAmountForMonth(
  line: DebtProjectionLine,
  targetMonth: Date,
  paidSoFar: number
): { amount: number; interestPortion?: number } | null {
  const result = (() => {
    if (line.schedule.kind === "flat") {
      const capped = Math.min(
        line.schedule.monthlyAmount,
        line.schedule.remainingBalance - paidSoFar
      );
      return capped > 0.005 ? { magnitude: capped } : null;
    }
    if (line.schedule.kind === "bill") {
      const { bill, remainingBalance } = line.schedule;
      if (!billAppliesToMonth(bill, targetMonth)) return null;
      // The debt's real balance is what ends this schedule, even if the bill
      // itself declares no recurrence end — the final payment is trimmed to
      // what's actually left, then the line stops.
      const capped = Math.min(monthlyEquivalentAmount(bill), remainingBalance - paidSoFar);
      return capped > 0.005 ? { magnitude: capped } : null;
    }
    const { principal, monthlyRatePercent, startDate, termMonths, loanType, remainingBalance } =
      line.schedule;
    // Read the start date's year/month straight off the "YYYY-MM-DD" string
    // rather than through `new Date(startDate)` — that parses as UTC
    // midnight, and diffing it against targetMonth's LOCAL year/month would
    // silently shift a 1st-of-month start into the previous month in any
    // negative-UTC-offset timezone (see shared/src/billCadence.ts, which hit
    // the exact same class of bug for bill due dates).
    const [startYear, startMonth] = startDate.split("-").map(Number);
    const monthOfLoan =
      (targetMonth.getFullYear() - startYear) * 12 +
      (targetMonth.getMonth() - (startMonth - 1)) +
      1;
    if (monthOfLoan < 1 || monthOfLoan > termMonths) return null;
    // Interest has to come off the REAL outstanding balance (remainingBalance
    // minus everything paid so far, including every extra-amortization bill
    // on this same debt) — not the closed-form balance the plain PRICE/SAC
    // schedule alone implies. An extra payment lowers the real balance below
    // what the nominal schedule assumes, so it genuinely lowers next month's
    // interest too; using the nominal balance here would overstate interest
    // for every month after an extra payment, understating exactly the
    // benefit ("this extra payment lowers my interest") the payment is for.
    // The fixed payment amount itself still comes from the ORIGINAL
    // principal/term (a real loan's contractual installment doesn't
    // recompute itself just because you paid extra — the "reduce term"
    // policy this whole app models), same as before.
    const realBalanceBefore = remainingBalance - paidSoFar;
    if (realBalanceBefore <= 0.005) return null;
    const r = monthlyRatePercent / 100;
    const interest = realBalanceBefore * r;
    const raw =
      loanType === "price"
        ? pricePayment(principal, monthlyRatePercent, termMonths)
        : principal / termMonths + interest;
    const capped = Math.min(raw, remainingBalance - paidSoFar);
    if (capped <= 0.005) return null;
    // Never let the interest portion exceed what's actually being paid this
    // month — the final, trimmed payment (an extra bill ended the debt early)
    // otherwise could report more interest than cash actually moved.
    return { magnitude: capped, interestPortion: Math.max(0, Math.min(interest, capped)) };
  })();
  if (result == null) return null;
  const signed = line.direction === "owed_by_me" ? -result.magnitude : result.magnitude;
  return { amount: signed, interestPortion: result.interestPortion };
}

function billForProjection(id: number): BillForProjection | null {
  const r = db
    .query(
      `SELECT b.id, b.name, b.expected_amount, b.cadence, b.next_due_date,
              b.recurrence_start_date, b.recurrence_end_date, c.name as category_name
       FROM recurring_bills b
       LEFT JOIN categories c ON c.id = b.category_id
       WHERE b.id = ?`
    )
    .get(id) as {
    id: number;
    name: string;
    expected_amount: number;
    cadence: string;
    next_due_date: string | null;
    recurrence_start_date: string | null;
    recurrence_end_date: string | null;
    category_name: string | null;
  } | null;
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    expectedAmount: r.expected_amount,
    cadence: r.cadence as Cadence,
    nextDueDate: r.next_due_date,
    recurrenceStartDate: r.recurrence_start_date,
    recurrenceEndDate: r.recurrence_end_date,
    isIncome: false,
    categoryName: r.category_name,
  };
}

interface DebtSchedules {
  lines: DebtProjectionLine[];
  // Bills claimed by a debt's projection line. They describe the same
  // real-world payment as that line, so they must be dropped from the
  // generic bill lines or the payment would be counted twice — this holds
  // even for a formal loan, where the formula (not the bill) sets the amount
  // and the linked bill only marks which bill is that payment.
  consumedBillIds: Set<number>;
}

// Turns each active debt's server-computed payment_plan (see computePaymentPlan
// in routes/debts.ts — the single resolution the Debts page also displays)
// into a projection line. Debts whose plan is "none" stay out of the
// projection rather than being guessed at.
function activeDebtSchedules(userId: number | null): DebtSchedules {
  // A debt merely shared with this person (not owned) doesn't inject payment
  // obligations into their own forecast — listDebts already includes it for
  // visibility on the Debts page, but only owned debts feed the projection.
  const debts = listDebts(userId).filter(
    (d) => d.status === "active" && d.remaining > 1 && d.is_owner
  );
  const lines: DebtProjectionLine[] = [];
  const consumedBillIds = new Set<number>();

  for (const debt of debts) {
    const plan = debt.payment_plan;

    if (plan.source === "loan") {
      lines.push({
        debtId: debt.id,
        name: debt.name,
        direction: debt.direction,
        schedule: {
          kind: "loan",
          loanType: plan.loan_type,
          principal: debt.principal,
          monthlyRatePercent: plan.rate_monthly_percent,
          startDate: debt.start_date,
          termMonths: plan.term_months,
          remainingBalance: debt.remaining,
        },
      });
      // Extra bills linked to a loan don't change the computed installment
      // above, but they're real extra amortization payments — they share the
      // same remainingBalance cap, so together with the loan line they can
      // pay the debt off faster than the plain schedule alone.
      for (const bill of plan.extra_bills) {
        if (consumedBillIds.has(bill.bill_id)) continue;
        const billForProj = billForProjection(bill.bill_id);
        if (!billForProj) continue;
        consumedBillIds.add(bill.bill_id);
        lines.push({
          debtId: debt.id,
          name: `${debt.name} — ${bill.bill_name}`,
          direction: debt.direction,
          schedule: { kind: "bill", bill: billForProj, remainingBalance: debt.remaining },
        });
      }
    } else if (plan.source === "combined") {
      // Every source here shares one remainingBalance cap (see
      // debtLineAmountForMonth) — several bills, or a bill plus the
      // automatic heuristic, can be paying down the same debt at once
      // without collectively overpaying it.
      for (const bill of plan.bills) {
        // First-wins if two debts ever point at the same bill — the second
        // would otherwise project the same payment twice.
        if (consumedBillIds.has(bill.bill_id)) continue;
        const billForProj = billForProjection(bill.bill_id);
        if (!billForProj) continue;
        consumedBillIds.add(bill.bill_id);
        lines.push({
          debtId: debt.id,
          name: `${debt.name} — ${bill.bill_name}`,
          direction: debt.direction,
          schedule: { kind: "bill", bill: billForProj, remainingBalance: debt.remaining },
        });
      }
      if (plan.automatic) {
        lines.push({
          debtId: debt.id,
          name: debt.name,
          direction: debt.direction,
          schedule: {
            kind: "flat",
            monthlyAmount: plan.automatic.monthly_amount,
            remainingBalance: debt.remaining,
          },
        });
      }
    }
  }

  return { lines, consumedBillIds };
}

export function computeProjection(options: ProjectionOptions = {}): ProjectionResult {
  const userId = options.userId ?? null;
  const horizonMonths = options.horizonMonths ?? DEFAULT_HORIZON_MONTHS;
  const overridesByBillId = new Map((options.billOverrides ?? []).map((o) => [o.billId, o.amount]));
  const discretionaryDeltaPercent = options.discretionaryDeltaPercent ?? 0;
  const interestRateAnnualPercent =
    options.interestRateAnnualPercent ?? DEFAULT_INTEREST_RATE_ANNUAL_PERCENT;
  // Compounding monthly, derived from the annual rate rather than a naive
  // /12 split — (1+r)^(1/12) - 1 is the rate that actually compounds to the
  // stated annual rate over 12 months.
  const monthlyInterestRate = (1 + interestRateAnnualPercent / 100) ** (1 / 12) - 1;

  const { lines: debtLines, consumedBillIds } = activeDebtSchedules(userId);
  const bills = activeConfirmedBills(userId).filter((b) => !consumedBillIds.has(b.id));
  const cardBills = cardExpenseBills(userId);
  // Income now comes entirely from confirmed income-kind bills — no generic
  // bank-transaction averaging left to contribute a "baseline" figure.
  const baselineIncome = 0;
  const cardSpendActualAverage = cardSpendBaseline(userId);
  // A cardSpendGoal is a deliberate target, not a recomputation of history —
  // it replaces the average outright rather than being scaled by the
  // discretionary delta (that delta is for nudging the real average, not for
  // adjusting an already-explicit goal). A per-request override wins if
  // given (what-if simulation); otherwise fall back to the persisted per-
  // person goal, so it applies consistently everywhere without re-specifying
  // it. Household (userId null) has no single goal to fall back to.
  const cardSpendGoal = options.cardSpendGoal ?? getSettings(userId).cardSpendGoal ?? undefined;
  const baselineExpense =
    cardSpendGoal ?? cardSpendActualAverage * (1 + discretionaryDeltaPercent / 100);

  const startingBalance = currentBalance(userId);
  // The very next month's card bill is a known, real number — what's
  // already on the card today — not a recurring assumption. Only the goal/
  // average stands in for months further out, where there's no concrete
  // balance yet to point to.
  const currentCardOwed = currentCardBalance(userId);

  let balance = startingBalance;
  const months: ProjectedMonth[] = [];
  const now = new Date();
  // Cumulative bill-driven payments per debt across the horizon, so a debt's
  // linked bill stops paying once the debt's remaining balance is exhausted.
  const paidByDebt = new Map<number, number>();

  for (let i = 1; i <= horizonMonths; i++) {
    const targetMonth = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const billLines: ProjectedMonth["bills"] = [];
    let net = baselineIncome;

    const cardExpenseThisMonth = i === 1 ? currentCardOwed : baselineExpense;
    if (cardExpenseThisMonth !== 0) {
      net -= cardExpenseThisMonth;
      // Another large sentinel id, distinct from interest's, so both can
      // coexist in the same month's line-item list without colliding.
      billLines.push({
        id: -999998,
        name:
          i === 1
            ? "Credit card bill (current balance)"
            : cardSpendGoal != null
              ? "Credit card spending (goal)"
              : "Credit card spending (3mo avg)",
        amount: -cardExpenseThisMonth,
        kind: "cardSpend",
        category_name: null,
      });
    }

    for (const bill of bills) {
      if (!billAppliesToMonth(bill, targetMonth)) continue;
      const amount = monthlyEquivalentAmount(bill, overridesByBillId.get(bill.id));
      const signed = bill.isIncome ? amount : -amount;
      net += signed;
      billLines.push({
        id: bill.id,
        name: bill.name,
        amount: signed,
        kind: "bill",
        category_name: bill.categoryName,
      });
    }

    // Not added to net/billLines — already folded into cardExpenseThisMonth
    // above. Purely informational, for views that specifically want to know
    // what's expected to hit a card this month (as opposed to overall cash flow).
    const cardExpenseLines = cardBills
      .filter((bill) => billAppliesToMonth(bill, targetMonth))
      .map((bill) => ({
        id: bill.id,
        name: bill.name,
        amount: -monthlyEquivalentAmount(bill, overridesByBillId.get(bill.id)),
        category_name: bill.categoryName,
      }));

    for (const debtLine of debtLines) {
      const paidSoFar = paidByDebt.get(debtLine.debtId) ?? 0;
      const result = debtLineAmountForMonth(debtLine, targetMonth, paidSoFar);
      if (result == null) continue;
      const { amount, interestPortion } = result;
      paidByDebt.set(debtLine.debtId, paidSoFar + Math.abs(amount));
      net += amount;
      // Negative ids keep debt lines from colliding with real bill ids in
      // the same array — bill overrides only ever target positive bill ids.
      billLines.push({
        id: -debtLine.debtId,
        name: `${debtLine.name} (debt)`,
        amount,
        kind: "debt",
        // A debt line without a linked bill has no real category to
        // attribute it to — left null rather than guessed at (consumers
        // conventionally bucket these under a synthetic "Debt Repayment").
        category_name:
          debtLine.schedule.kind === "bill" ? debtLine.schedule.bill.categoryName : null,
        ...(debtLine.schedule.kind === "bill" ? { billId: debtLine.schedule.bill.id } : {}),
        ...(interestPortion != null ? { interestPortion } : {}),
      });
    }

    // Interest accrues on the balance carried into the month (before this
    // month's own net flows) — a debt/overdrawn balance doesn't "earn"
    // interest here, since this models idle cash sitting in an
    // interest-bearing account, not a credit line.
    if (balance > 0) {
      const interest = balance * monthlyInterestRate;
      net += interest;
      // A large sentinel id keeps this from colliding with a real bill id
      // (positive) or a debt line's negative id (-debtId, small positive range).
      billLines.push({
        id: -999999,
        name: `Interest (${interestRateAnnualPercent}% a.a.)`,
        amount: interest,
        kind: "interest",
        category_name: null,
      });
    }

    balance += net;
    months.push({
      monthIndex: i,
      label: `${targetMonth.getFullYear()}-${String(targetMonth.getMonth() + 1).padStart(2, "0")}`,
      net,
      balance,
      shortfall: balance < config.minBuffer,
      bills: billLines,
      cardExpenseBills: cardExpenseLines,
    });
  }

  return { startingBalance, baselineIncome, baselineExpense, cardSpendActualAverage, months };
}
