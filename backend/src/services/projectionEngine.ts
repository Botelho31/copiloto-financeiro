import type { BillOverride, ProjectedMonth, ProjectionResult } from "shared";
import { pricePayment, sacPaymentForMonth } from "shared";
import { config } from "../config";
import { db } from "../db";
import { getDebtTransactions, listDebts } from "../routes/debts";
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
}

// Only BANK-type accounts (checking/savings) represent liquid cash. A CREDIT
// account's `balance` is the amount owed on the card — a liability, not cash
// on hand — so it must not be pooled into the projected starting balance.
export function currentBalance(): number {
  const row = db
    .query("SELECT COALESCE(SUM(balance), 0) as total FROM accounts WHERE type = 'BANK'")
    .get() as { total: number };
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
export function currentCardBalance(): number {
  const totalRow = db
    .query("SELECT COALESCE(SUM(balance), 0) as total FROM accounts WHERE type = 'CREDIT'")
    .get() as { total: number };

  const now = new Date();
  const dueAfterNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 1)
    .toISOString()
    .slice(0, 10);
  const notYetDueRow = db
    .query(
      `SELECT COALESCE(SUM(t.amount), 0) as total
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE a.type = 'CREDIT' AND t.type = 'DEBIT' AND t.date >= ?`
    )
    .get(dueAfterNextMonth) as { total: number };

  return totalRow.total - notYetDueRow.total;
}

// Bills flagged is_card_expense are excluded entirely — that spend gets
// charged to a credit card, so it's already absorbed into the card-spend
// goal/average line rather than being additional spend on top of it. They
// still exist as trackable bills (visible, editable, deletable on the Bills
// page); the flag just keeps the projection from double-counting them.
function activeConfirmedBills(): BillForProjection[] {
  const rows = db
    .query(
      `SELECT b.id, b.name, b.expected_amount, b.cadence, b.next_due_date,
              b.recurrence_start_date, b.recurrence_end_date, c.kind as category_kind
       FROM recurring_bills b
       LEFT JOIN categories c ON c.id = b.category_id
       WHERE b.confirmed = 1 AND b.active = 1 AND b.is_card_expense = 0`
    )
    .all() as {
    id: number;
    name: string;
    expected_amount: number;
    cadence: string;
    next_due_date: string | null;
    recurrence_start_date: string | null;
    recurrence_end_date: string | null;
    category_kind: string | null;
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
  }));
}

// The mirror image of activeConfirmedBills — is_card_expense bills, which
// are excluded from net/billLines entirely so as not to double up against
// the card-spend goal/average. They're still worth surfacing separately
// wherever the point is specifically "what's expected to hit a card this
// month" (e.g. the Dashboard's per-card chart), just not folded into the
// overall cashflow numbers.
function cardExpenseBills(): BillForProjection[] {
  const rows = db
    .query(
      `SELECT b.id, b.name, b.expected_amount, b.cadence, b.next_due_date,
              b.recurrence_start_date, b.recurrence_end_date
       FROM recurring_bills b
       WHERE b.confirmed = 1 AND b.active = 1 AND b.is_card_expense = 1`
    )
    .all() as {
    id: number;
    name: string;
    expected_amount: number;
    cadence: string;
    next_due_date: string | null;
    recurrence_start_date: string | null;
    recurrence_end_date: string | null;
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
function cardSpendBaseline(): number {
  const now = new Date();
  const since = new Date();
  since.setMonth(since.getMonth() - BASELINE_LOOKBACK_MONTHS);
  const sinceStr = since.toISOString().slice(0, 10);
  const nowStr = now.toISOString().slice(0, 10);

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
         )`
    )
    .get(sinceStr, nowStr) as { total: number };

  return row.total / BASELINE_LOOKBACK_MONTHS;
}

interface DebtProjectionLine {
  debtId: number;
  name: string;
  direction: "owed_by_me" | "owed_to_me";
  schedule:
    | {
        // History-based: a flat amount inferred from real past payments,
        // valid for a fixed number of months from now.
        kind: "flat";
        monthlyAmount: number;
        remainingMonths: number;
      }
    | {
        // Formula-based: computed fresh for any calendar month from the
        // loan's own terms — doesn't need payment history, so it works for
        // a future loan (e.g. a mortgage that hasn't closed yet) just as
        // well as one already underway.
        kind: "loan";
        loanType: "price" | "sac";
        principal: number;
        monthlyRatePercent: number;
        startDate: string;
        termMonths: number;
      };
}

// Signed amount for a debt line in a given calendar month, or null if the
// debt doesn't apply that month (not started yet, already paid off, or the
// flat schedule's remaining-months window has passed).
function debtLineAmountForMonth(line: DebtProjectionLine, targetMonth: Date, monthIndex: number): number | null {
  const magnitude = (() => {
    if (line.schedule.kind === "flat") {
      if (monthIndex > line.schedule.remainingMonths) return null;
      return line.schedule.monthlyAmount;
    }
    const { principal, monthlyRatePercent, startDate, termMonths, loanType } = line.schedule;
    const start = new Date(startDate);
    const monthOfLoan =
      (targetMonth.getFullYear() - start.getFullYear()) * 12 +
      (targetMonth.getMonth() - start.getMonth()) +
      1;
    if (monthOfLoan < 1 || monthOfLoan > termMonths) return null;
    return loanType === "price"
      ? pricePayment(principal, monthlyRatePercent, termMonths)
      : sacPaymentForMonth(principal, monthlyRatePercent, termMonths, monthOfLoan);
  })();
  if (magnitude == null) return null;
  return line.direction === "owed_by_me" ? -magnitude : magnitude;
}

// A debt only counts as "solid" here if its own payment history is a real
// fixed installment (e.g. Estudio Foz: exactly R$4,389 every time) — not
// just any historical average. A debt paid off in irregular, wildly
// different amounts (e.g. Juliana's house-share repayments ranging from
// R$1,478 to R$7,000) has no real cadence to extrapolate; averaging it
// anyway would smuggle a guess back in as if it were certain.
const MAX_INSTALLMENT_COEFFICIENT_OF_VARIATION = 0.15;

// Estimates each active debt's ongoing monthly installment from the average
// of its own actual pay_off transactions (not a fixed schedule field — the
// app doesn't store one), and how many more months that implies given what's
// still remaining. Debts with no payment history, or with irregular payment
// amounts, are skipped rather than guessed at.
function monthsBetweenDates(fromDate: string, toDate: string): number {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function activeDebtSchedules(): DebtProjectionLine[] {
  const debts = listDebts().filter((d) => d.status === "active" && d.remaining > 1);
  const lines: DebtProjectionLine[] = [];

  for (const debt of debts) {
    // A formula-based loan (Price/SAC) takes priority over the payment-
    // history heuristic below — it's deterministic from the loan's own
    // terms, so it works for a loan that hasn't started yet (no history to
    // infer from) just as well as one already underway, and doesn't drift
    // based on incidental payment-timing noise once it has.
    if (debt.loan_type && debt.interest_rate_monthly_percent != null && debt.target_payoff_date) {
      const termMonths = monthsBetweenDates(debt.start_date, debt.target_payoff_date);
      if (termMonths > 0) {
        lines.push({
          debtId: debt.id,
          name: debt.name,
          direction: debt.direction,
          schedule: {
            kind: "loan",
            loanType: debt.loan_type,
            principal: debt.principal,
            monthlyRatePercent: debt.interest_rate_monthly_percent,
            startDate: debt.start_date,
            termMonths,
          },
        });
        continue;
      }
    }

    const payOffs = getDebtTransactions(debt.id).filter((t) => t.role === "pay_off");
    if (payOffs.length < 2) continue; // one data point isn't a cadence

    const amounts = payOffs.map((t) => Math.abs(t.amount));
    const avgInstallment = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
    if (avgInstallment <= 0) continue;

    const variance =
      amounts.reduce((sum, a) => sum + (a - avgInstallment) ** 2, 0) / amounts.length;
    const coefficientOfVariation = Math.sqrt(variance) / avgInstallment;
    if (coefficientOfVariation > MAX_INSTALLMENT_COEFFICIENT_OF_VARIATION) continue;

    const remainingMonths = Math.max(1, Math.round(debt.remaining / avgInstallment));
    lines.push({
      debtId: debt.id,
      name: debt.name,
      direction: debt.direction,
      schedule: { kind: "flat", monthlyAmount: avgInstallment, remainingMonths },
    });
  }

  return lines;
}

function withinRecurrenceBounds(bill: BillForProjection, targetMonth: Date): boolean {
  // A month is "in bounds" if any part of it falls on/after the start date
  // and on/before the end date — so a bill starting mid-March still applies
  // to the March bucket, and one ending mid-October still applies to October.
  const monthEnd = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0);
  if (bill.recurrenceStartDate && monthEnd < new Date(bill.recurrenceStartDate)) return false;
  if (bill.recurrenceEndDate && targetMonth > new Date(bill.recurrenceEndDate)) return false;
  return true;
}

function billAppliesToMonth(bill: BillForProjection, targetMonth: Date): boolean {
  if (!withinRecurrenceBounds(bill, targetMonth)) return false;

  // A "once" bill whose date has already passed is done — it must never
  // project forward again, explicitly, regardless of month/year matching.
  if (bill.cadence === "once" && bill.nextDueDate && new Date(bill.nextDueDate) < new Date()) {
    return false;
  }

  if (bill.cadence === "monthly" || bill.cadence === "weekly") return true;
  if (!bill.nextDueDate) return false;
  const due = new Date(bill.nextDueDate);

  if (bill.cadence === "yearly") return due.getMonth() === targetMonth.getMonth();

  if (bill.cadence === "quarterly") {
    const monthDiff =
      (targetMonth.getFullYear() - due.getFullYear()) * 12 +
      (targetMonth.getMonth() - due.getMonth());
    return monthDiff >= 0 && monthDiff % 3 === 0;
  }

  // "once": a single future occurrence, never repeats — must match the
  // exact year and month, not just the calendar month like "yearly" does.
  return due.getFullYear() === targetMonth.getFullYear() && due.getMonth() === targetMonth.getMonth();
}

function monthlyEquivalentAmount(bill: BillForProjection, overrideAmount?: number): number {
  const base = overrideAmount ?? bill.expectedAmount;
  return bill.cadence === "weekly" ? base * (52 / 12) : base;
}

export function computeProjection(options: ProjectionOptions = {}): ProjectionResult {
  const horizonMonths = options.horizonMonths ?? DEFAULT_HORIZON_MONTHS;
  const overridesByBillId = new Map(
    (options.billOverrides ?? []).map((o) => [o.billId, o.amount])
  );
  const discretionaryDeltaPercent = options.discretionaryDeltaPercent ?? 0;
  const interestRateAnnualPercent =
    options.interestRateAnnualPercent ?? DEFAULT_INTEREST_RATE_ANNUAL_PERCENT;
  // Compounding monthly, derived from the annual rate rather than a naive
  // /12 split — (1+r)^(1/12) - 1 is the rate that actually compounds to the
  // stated annual rate over 12 months.
  const monthlyInterestRate = (1 + interestRateAnnualPercent / 100) ** (1 / 12) - 1;

  const bills = activeConfirmedBills();
  const cardBills = cardExpenseBills();
  const debtLines = activeDebtSchedules();
  // Income now comes entirely from confirmed income-kind bills — no generic
  // bank-transaction averaging left to contribute a "baseline" figure.
  const baselineIncome = 0;
  const cardSpendActualAverage = cardSpendBaseline();
  // A cardSpendGoal is a deliberate target, not a recomputation of history —
  // it replaces the average outright rather than being scaled by the
  // discretionary delta (that delta is for nudging the real average, not for
  // adjusting an already-explicit goal). A per-request override wins if
  // given (what-if simulation); otherwise fall back to the persisted global
  // goal, so it applies consistently everywhere without re-specifying it.
  const cardSpendGoal = options.cardSpendGoal ?? getSettings().cardSpendGoal ?? undefined;
  const baselineExpense =
    cardSpendGoal ?? cardSpendActualAverage * (1 + discretionaryDeltaPercent / 100);

  const startingBalance = currentBalance();
  // The very next month's card bill is a known, real number — what's
  // already on the card today — not a recurring assumption. Only the goal/
  // average stands in for months further out, where there's no concrete
  // balance yet to point to.
  const currentCardOwed = currentCardBalance();

  let balance = startingBalance;
  const months: ProjectedMonth[] = [];
  const now = new Date();

  for (let i = 1; i <= horizonMonths; i++) {
    const targetMonth = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const billLines: {
      id: number;
      name: string;
      amount: number;
      kind: "bill" | "debt" | "interest" | "cardSpend";
    }[] = [];
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
      });
    }

    for (const bill of bills) {
      if (!billAppliesToMonth(bill, targetMonth)) continue;
      const amount = monthlyEquivalentAmount(bill, overridesByBillId.get(bill.id));
      const signed = bill.isIncome ? amount : -amount;
      net += signed;
      billLines.push({ id: bill.id, name: bill.name, amount: signed, kind: "bill" });
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
      }));

    for (const debtLine of debtLines) {
      const amount = debtLineAmountForMonth(debtLine, targetMonth, i);
      if (amount == null) continue;
      net += amount;
      // Negative ids keep debt lines from colliding with real bill ids in
      // the same array — bill overrides only ever target positive bill ids.
      billLines.push({
        id: -debtLine.debtId,
        name: `${debtLine.name} (debt)`,
        amount,
        kind: "debt",
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
