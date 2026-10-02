import type {
  Bill,
  Debt,
  DebtBalanceHistoryEntry,
  DebtBalanceScheduleEntry,
  DebtLinkedTransaction,
  DebtPaymentPlan,
} from "shared";
import {
  addMonthsIso,
  billAppliesToMonth,
  localMonthDate,
  monthlyEquivalentAmount,
  pricePayment,
  sacPaymentForMonth,
  simulateAmortization,
} from "shared";
import { getDb } from "../db";

interface LinkedBillRow {
  id: number;
  name: string;
  expected_amount: number;
  cadence: string;
  next_due_date: string | null;
  recurrence_start_date: string | null;
  recurrence_end_date: string | null;
}

// Unconfirmed/inactive bills don't project, and a card-expense bill is
// already absorbed into the card-spend goal/average — none of them can
// stand in as part of this debt's schedule without double- or ghost-counting.
async function fetchLinkedBills(debtId: number): Promise<LinkedBillRow[]> {
  const result = await getDb().execute({
    sql: `SELECT id, name, expected_amount, cadence, next_due_date, recurrence_start_date, recurrence_end_date
          FROM recurring_bills
          WHERE debt_id = ? AND confirmed = 1 AND active = 1 AND is_card_expense = 0`,
    args: [debtId],
  });
  return result.rows as unknown as LinkedBillRow[];
}

interface DebtRow {
  id: number;
  name: string;
  direction: "owed_by_me" | "owed_to_me";
  counterparty: string | null;
  user_id: number;
  shared_with_user_id: number | null;
  shared_with_user_name: string | null;
  principal_amount: number | null;
  split_percentage: number | null;
  expected_total_amount: number | null;
  interest_rate_monthly_percent: number | null;
  start_date: string;
  target_payoff_date: string | null;
  status: "active" | "paid_off";
  notes: string | null;
  matching_rule: string | null;
  loan_type: "price" | "sac" | null;
  override_automatic_schedule: number;
}

// Reads year/month straight off each "YYYY-MM-DD" string rather than through
// `new Date(iso)` — that parses as UTC midnight, and a date landing on the
// 1st shifts back into the previous month's evening in any negative-UTC-
// offset timezone, silently inflating/deflating a term-months diff by one
// whenever only one of the two dates happens to fall on the 1st.
export function monthsBetweenDates(fromDate: string, toDate: string): number {
  const [fromYear, fromMonth] = fromDate.split("-").map(Number);
  const [toYear, toMonth] = toDate.split("-").map(Number);
  return (toYear! - fromYear!) * 12 + (toMonth! - fromMonth!);
}

// A payment history only counts as an inferable schedule if it's a real fixed
// installment (e.g. Estudio Foz: exactly R$4,389 every time) — not just any
// historical average. Payments in wildly different amounts (e.g. R$1,478 to
// R$7,000) have no cadence to extrapolate; averaging them anyway would
// smuggle a guess back in as if it were certain.
const MAX_INSTALLMENT_COEFFICIENT_OF_VARIATION = 0.15;

// The one place that decides how a debt's expected payment is calculated —
// both the Debts page (which states it) and the projection engine (which
// acts on it) read this, so they can't disagree. A formal loan's own formula
// always wins outright (deterministic, works before any payment exists).
// Otherwise, every explicitly linked bill counts (each keeping its own real
// cadence, not flattened into a blended guess), plus — unless the debt opts
// out — the fixed-installment history heuristic layered on top, since a bill
// might cover only part of what's actually being paid.
async function computePaymentPlan(
  row: DebtRow,
  principal: number,
  remaining: number,
  linkedBills: LinkedBillRow[]
): Promise<DebtPaymentPlan> {
  if (row.loan_type && row.interest_rate_monthly_percent != null && row.target_payoff_date) {
    const termMonths = monthsBetweenDates(row.start_date, row.target_payoff_date);
    if (termMonths > 0) {
      const now = new Date();
      const nextMonth = `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, "0")}-01`;
      const monthOfLoan = Math.min(
        termMonths,
        Math.max(1, monthsBetweenDates(row.start_date, nextMonth) + 1)
      );
      return {
        source: "loan",
        loan_type: row.loan_type,
        monthly_amount:
          row.loan_type === "price"
            ? pricePayment(principal, row.interest_rate_monthly_percent, termMonths)
            : sacPaymentForMonth(
                principal,
                row.interest_rate_monthly_percent,
                termMonths,
                monthOfLoan
              ),
        rate_monthly_percent: row.interest_rate_monthly_percent,
        term_months: termMonths,
        extra_bills: linkedBills.map((b) => ({
          bill_id: b.id,
          bill_name: b.name,
          amount: b.expected_amount,
          cadence: b.cadence as Bill["cadence"],
        })),
      };
    }
  }

  const amountsResult = await getDb().execute({
    sql: `SELECT ABS(t.amount) as amount
          FROM debt_transactions dt
          JOIN transactions t ON t.id = dt.transaction_id
          WHERE dt.debt_id = ? AND dt.role = 'pay_off'`,
    args: [row.id],
  });
  const amounts = (amountsResult.rows as unknown as { amount: number }[]).map((r) => r.amount);

  let automatic: { monthly_amount: number; payment_count: number } | null = null;
  if (!row.override_automatic_schedule && amounts.length >= 2) {
    const avg = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
    if (avg > 0) {
      const variance = amounts.reduce((sum, a) => sum + (a - avg) ** 2, 0) / amounts.length;
      if (Math.sqrt(variance) / avg <= MAX_INSTALLMENT_COEFFICIENT_OF_VARIATION) {
        automatic = { monthly_amount: avg, payment_count: amounts.length };
      }
    }
  }

  if (linkedBills.length === 0 && automatic == null) {
    return { source: "none", payment_count: amounts.length };
  }

  return {
    source: "combined",
    bills: linkedBills.map((b) => ({
      bill_id: b.id,
      bill_name: b.name,
      amount: b.expected_amount,
      cadence: b.cadence as Bill["cadence"],
    })),
    automatic,
    overrides_automatic_schedule: row.override_automatic_schedule === 1,
  };
}

const MAX_FINISH_MONTHS = 600; // 50 years is plenty of a ceiling to simulate toward

// The full month-by-month "what's still owed" walk for a debt — same date/
// totals a chart or "finish date" card stat should ever show, walked forward
// from payment_plan (never re-derived independently), so this can never
// disagree with what the projection engine's own month-by-month debt lines
// converge on. A loan's extra-amortization bills are folded in with the
// exact same shared remaining-balance cap projectionEngine.ts uses (the fixed
// installment's own interest/amortization split never changes because of an
// extra payment — the contract doesn't recompute itself — but cumulative
// cash toward the debt, installment plus every extra bill, is capped against
// `remaining` and trims/stops the schedule the moment it's exhausted).
//
// Each entry's principal_owed is the outstanding balance right after that
// month's payment; interest_owed is a *suffix sum* — all the interest still
// left to accrue from that month through payoff, not just that one month's
// slice — so both figures shrink to exactly 0 together at the final month,
// matching "what do I still owe, all-in, including interest yet to come."
function computeProjectedBalanceSchedule(
  row: DebtRow,
  plan: DebtPaymentPlan,
  principal: number,
  remaining: number,
  linkedBills: LinkedBillRow[]
): {
  schedule: DebtBalanceScheduleEntry[];
  finishDate: string | null;
  remainingInterest: number | null;
} {
  const empty = { schedule: [], finishDate: null, remainingInterest: null };
  if (row.status !== "active") return empty;
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = row.start_date > today ? row.start_date : today;
  if (remaining <= 0.005) return { schedule: [], finishDate: fromDate, remainingInterest: 0 };

  const months: string[] = [];
  const principalOwed: number[] = [];
  const interestThisMonth: number[] = [];
  let reachedPayoff = false;

  if (plan.source === "loan") {
    const rate = plan.rate_monthly_percent;
    const r = rate / 100;
    let termCeiling = 0;
    while (
      termCeiling < MAX_FINISH_MONTHS &&
      row.target_payoff_date != null &&
      addMonthsIso(fromDate, termCeiling + 1) <= row.target_payoff_date
    )
      termCeiling++;
    termCeiling = Math.max(1, termCeiling);

    // Fixed payment/amortization come off the ORIGINAL principal and term —
    // same basis as plan.monthly_amount and the projection engine's own loan
    // line — a real loan's contractual installment doesn't recompute itself
    // just because extra payments were made or time has passed; only the
    // interest split (below) responds to the real, extras-reduced balance.
    const fixedPayment = plan.loan_type === "price" ? plan.monthly_amount : null;
    const fixedAmortization = plan.loan_type === "sac" ? principal / plan.term_months : null;
    let paidSoFar = 0;
    for (let month = 1; month <= termCeiling && paidSoFar < remaining - 0.005; month++) {
      const targetMonth = localMonthDate(fromDate, month - 1);
      // Interest comes off the REAL outstanding balance (remaining minus
      // everything paid so far, including extras) — not a closed-form
      // nominal schedule that ignores extras. An extra payment lowers the
      // real balance below what the plain schedule assumes, so it genuinely
      // lowers next month's interest too; using the nominal balance would
      // overstate interest for every month after an extra payment.
      const realBalanceBefore = remaining - paidSoFar;
      const interest = realBalanceBefore * r;
      const rawPayment = fixedPayment != null ? fixedPayment : fixedAmortization! + interest;
      const cappedPayment = Math.min(rawPayment, remaining - paidSoFar);
      if (cappedPayment <= 0.005) break;
      const interestPortion = Math.min(interest, cappedPayment);
      paidSoFar += cappedPayment;
      if (paidSoFar < remaining - 0.005) {
        const extra = linkedBills.reduce((sum, b) => {
          const info = {
            cadence: b.cadence as Bill["cadence"],
            nextDueDate: b.next_due_date,
            recurrenceStartDate: b.recurrence_start_date,
            recurrenceEndDate: b.recurrence_end_date,
          };
          if (!billAppliesToMonth(info, targetMonth)) return sum;
          return (
            sum +
            monthlyEquivalentAmount({
              cadence: b.cadence as Bill["cadence"],
              expectedAmount: b.expected_amount,
            })
          );
        }, 0);
        paidSoFar += Math.min(extra, remaining - paidSoFar);
      }
      months.push(addMonthsIso(fromDate, month - 1));
      principalOwed.push(Math.max(0, remaining - paidSoFar));
      interestThisMonth.push(interestPortion);
    }
    reachedPayoff = paidSoFar >= remaining - 0.005;
  } else if (plan.source === "combined") {
    // Each bill keeps its own real cadence here too — summing every linked
    // bill's monthly-equivalent into one blanket "monthly" figure (as if a
    // once-off bill recurred every month forever) would wildly overstate the
    // payment and pay the debt off in a couple of months instead of however
    // long the bills actually take, exactly the way activeDebtSchedules /
    // debtLineAmountForMonth in projectionEngine.ts already handle it.
    const rate = row.interest_rate_monthly_percent;
    const r = rate != null && rate > 0 ? rate / 100 : 0;
    let balance = remaining;
    let month = 0;
    for (; month < MAX_FINISH_MONTHS && balance > 0.005; month++) {
      const targetMonth = localMonthDate(fromDate, month);
      const interest = balance * r;
      const billsDue = linkedBills.reduce((sum, b) => {
        const info = {
          cadence: b.cadence as Bill["cadence"],
          nextDueDate: b.next_due_date,
          recurrenceStartDate: b.recurrence_start_date,
          recurrenceEndDate: b.recurrence_end_date,
        };
        if (!billAppliesToMonth(info, targetMonth)) return sum;
        return (
          sum +
          monthlyEquivalentAmount({
            cadence: b.cadence as Bill["cadence"],
            expectedAmount: b.expected_amount,
          })
        );
      }, 0);
      const monthlyPayment = billsDue + (plan.automatic?.monthly_amount ?? 0);
      // A month with nothing due (waiting on a yearly/quarterly bill's next
      // occurrence) is expected, not a stall — only the MAX_FINISH_MONTHS
      // ceiling below decides when to give up on ever converging.
      balance = Math.max(0, balance * (1 + r) - monthlyPayment);
      months.push(addMonthsIso(fromDate, month));
      principalOwed.push(balance);
      interestThisMonth.push(r > 0 ? interest : 0);
    }
    reachedPayoff = balance <= 0.005;
  }

  if (!reachedPayoff) return empty;

  // Suffix sum EXCLUDING each month's own interest — principal_owed above is
  // already post-payment (this month's payment already subtracted), so
  // interest_owed has to be post-payment too: interest still left across every
  // month AFTER this one, not including the slice that just got paid off this
  // month. Without the exclusion, the final month would show principal_owed
  // 0 (debt done) next to a non-zero interest_owed (as if that same month's
  // interest hadn't been paid), which contradicts itself.
  const interestOwed: number[] = new Array(interestThisMonth.length).fill(0);
  let runningInterest = 0;
  for (let i = interestThisMonth.length - 1; i >= 0; i--) {
    interestOwed[i] = runningInterest;
    runningInterest += interestThisMonth[i]!;
  }

  const schedule: DebtBalanceScheduleEntry[] = months.map((month, i) => ({
    month: month.slice(0, 7),
    principal_owed: principalOwed[i]!,
    interest_owed: interestOwed[i]!,
  }));

  return {
    schedule,
    finishDate: months.length > 0 ? months[months.length - 1]! : null,
    remainingInterest: interestThisMonth.reduce((sum, v) => sum + v, 0),
  };
}

const MAX_HISTORY_MONTHS = 360; // 30 years of monthly points is plenty for a chart

// The historical mirror of computeProjectedBalanceSchedule — real past
// balance, month by month, from real pay_off payments (never re-derived by
// the frontend; this used to be reimplemented by hand in Debts.tsx, see
// backend/API-ARCHITECTURE.md's R1). With a rate, re-runs simulateAmortization
// as of each month's end (interest-aware); without one, the balance at any
// past month is just today's remaining plus whatever was paid back out
// *after* that month, since a rate-less debt only ever declines by real
// payments. A debt marked paid off is settled regardless of what the
// arithmetic remaining says.
function computeBalanceHistory(
  row: DebtRow,
  principal: number,
  remaining: number,
  payments: { id: string; date: string; amount: number }[]
): DebtBalanceHistoryEntry[] {
  const today = new Date().toISOString().slice(0, 10);
  if (row.start_date > today) return [];

  let elapsed = 0;
  while (elapsed < MAX_HISTORY_MONTHS && addMonthsIso(row.start_date, elapsed + 1) <= today)
    elapsed++;

  const hasRate = row.interest_rate_monthly_percent != null && principal > 0;
  const anchor = row.status === "paid_off" ? 0 : Math.max(0, remaining);

  const history: DebtBalanceHistoryEntry[] = [];
  for (let m = 0; m <= elapsed; m++) {
    const date = addMonthsIso(row.start_date, m);
    const balance = hasRate
      ? Math.max(
          0,
          simulateAmortization(
            principal,
            row.interest_rate_monthly_percent!,
            row.start_date,
            payments.filter((p) => p.date <= date),
            date
          ).currentPayoffBalance
        )
      : Math.max(
          0,
          anchor + payments.filter((p) => p.date > date).reduce((sum, p) => sum + p.amount, 0)
        );
    history.push({ month: date.slice(0, 7), balance });
  }
  return history;
}

async function computeDebt(row: DebtRow, visiting: Set<number> = new Set()): Promise<Debt> {
  const db = getDb();
  const txOriginSumResult = await db.execute({
    sql: `SELECT COALESCE(SUM(ABS(t.amount)), 0) as total
          FROM debt_transactions dt
          JOIN transactions t ON t.id = dt.transaction_id
          WHERE dt.debt_id = ? AND dt.role IN ('borrow', 'lend')`,
    args: [row.id],
  });
  const txOriginSum = (txOriginSumResult.rows[0] as unknown as { total: number }).total;

  // A whole other debt can feed into this one's origin sum — e.g. the full
  // Estudio Foz architect debt (present AND future installments, not just
  // the ones already paid) counts toward Juliana's 20% house-cost share.
  // But only once that child debt has actually started — a future debt (e.g.
  // a mortgage that hasn't closed yet) hasn't incurred anything, so folding
  // its full principal in early would inflate the parent's already-active
  // balance for money that isn't owed yet.
  // Guard against cycles (A links to B links to A) since two debts can now
  // reference each other.
  const today = new Date().toISOString().slice(0, 10);
  const nextVisiting = new Set(visiting).add(row.id);
  const linkedDebtRowsResult = await db.execute({
    sql: "SELECT child_debt_id FROM debt_links WHERE parent_debt_id = ?",
    args: [row.id],
  });
  const linkedDebtChildIds = linkedDebtRowsResult.rows as unknown as { child_debt_id: number }[];
  const linkedDebts: {
    id: number;
    name: string;
    principal: number;
    countsTowardOrigin: boolean;
  }[] = [];
  for (const { child_debt_id } of linkedDebtChildIds) {
    if (visiting.has(child_debt_id)) continue;
    const childRow = await getDebtRow(child_debt_id);
    if (!childRow) continue;
    const childComputed = await computeDebt(childRow, nextVisiting);
    // The displayed principal is always the real figure — only whether it
    // counts toward *this* debt's origin sum depends on whether the child
    // has actually started.
    linkedDebts.push({
      id: childRow.id,
      name: childRow.name,
      principal: childComputed.principal,
      countsTowardOrigin: childRow.start_date <= today,
    });
  }

  const originSum =
    txOriginSum +
    linkedDebts.filter((d) => d.countsTowardOrigin).reduce((sum, d) => sum + d.principal, 0);

  const totalPaidResult = await db.execute({
    sql: `SELECT COALESCE(SUM(ABS(t.amount)), 0) as total
          FROM debt_transactions dt
          JOIN transactions t ON t.id = dt.transaction_id
          WHERE dt.debt_id = ? AND dt.role = 'pay_off'`,
    args: [row.id],
  });
  const totalPaid = (totalPaidResult.rows[0] as unknown as { total: number }).total;

  const transactionCountResult = await db.execute({
    sql: "SELECT COUNT(*) as n FROM debt_transactions WHERE debt_id = ?",
    args: [row.id],
  });
  const transactionCount = (transactionCountResult.rows[0] as unknown as { n: number }).n;

  const principal =
    row.split_percentage != null
      ? originSum * (row.split_percentage / 100)
      : (row.principal_amount ?? originSum);

  if (row.interest_rate_monthly_percent != null && principal > 0) {
    const paymentsResult = await db.execute({
      sql: `SELECT t.id, t.date, ABS(t.amount) as amount
            FROM debt_transactions dt
            JOIN transactions t ON t.id = dt.transaction_id
            WHERE dt.debt_id = ? AND dt.role = 'pay_off'`,
      args: [row.id],
    });
    const payments = paymentsResult.rows as unknown as {
      id: string;
      date: string;
      amount: number;
    }[];

    const sim = simulateAmortization(
      principal,
      row.interest_rate_monthly_percent,
      row.start_date,
      payments
    );

    const linkedBills = await fetchLinkedBills(row.id);
    const plan = await computePaymentPlan(row, principal, sim.currentPayoffBalance, linkedBills);
    const { schedule, finishDate, remainingInterest } = computeProjectedBalanceSchedule(
      row,
      plan,
      principal,
      sim.currentPayoffBalance,
      linkedBills
    );
    const balanceHistory = computeBalanceHistory(
      row,
      principal,
      sim.currentPayoffBalance,
      payments
    );

    return {
      ...row,
      is_owner: true,
      override_automatic_schedule: row.override_automatic_schedule === 1,
      principal,
      total_paid: totalPaid,
      remaining: sim.currentPayoffBalance,
      percent_complete: totalPaid > 0 ? totalPaid / (totalPaid + sim.currentPayoffBalance) : 0,
      interest_paid_so_far: sim.totalInterestPaid,
      remaining_principal: sim.principalRemaining,
      remaining_interest: sim.interestAccruedSinceLastPayment,
      transaction_count: transactionCount,
      linked_debts: linkedDebts,
      payment_plan: plan,
      projected_finish_date: finishDate,
      projected_remaining_interest: remainingInterest,
      projected_balance_schedule: schedule,
      balance_history: balanceHistory,
    };
  }

  const target = row.expected_total_amount ?? principal;
  const remaining = target - totalPaid;
  const percentComplete = target > 0 ? totalPaid / target : 0;
  const interestPaidSoFar =
    row.expected_total_amount != null && row.expected_total_amount > 0
      ? totalPaid * ((row.expected_total_amount - principal) / row.expected_total_amount)
      : null;

  const linkedBills = await fetchLinkedBills(row.id);
  const plan = await computePaymentPlan(row, principal, remaining, linkedBills);
  const { schedule, finishDate, remainingInterest } = computeProjectedBalanceSchedule(
    row,
    plan,
    principal,
    remaining,
    linkedBills
  );
  const payOffPaymentsResult = await db.execute({
    sql: `SELECT t.id, t.date, ABS(t.amount) as amount
          FROM debt_transactions dt
          JOIN transactions t ON t.id = dt.transaction_id
          WHERE dt.debt_id = ? AND dt.role = 'pay_off'`,
    args: [row.id],
  });
  const payOffPayments = payOffPaymentsResult.rows as unknown as {
    id: string;
    date: string;
    amount: number;
  }[];
  const balanceHistory = computeBalanceHistory(row, principal, remaining, payOffPayments);

  return {
    ...row,
    is_owner: true,
    override_automatic_schedule: row.override_automatic_schedule === 1,
    principal,
    total_paid: totalPaid,
    remaining,
    percent_complete: percentComplete,
    interest_paid_so_far: interestPaidSoFar,
    remaining_principal: null,
    remaining_interest: null,
    transaction_count: transactionCount,
    linked_debts: linkedDebts,
    payment_plan: plan,
    projected_finish_date: finishDate,
    projected_remaining_interest: remainingInterest,
    projected_balance_schedule: schedule,
    balance_history: balanceHistory,
  };
}

const DEBT_ROW_COLUMNS = `d.id, d.name, d.direction, d.counterparty, d.user_id, d.shared_with_user_id,
              su.name as shared_with_user_name, d.principal_amount, d.split_percentage,
              d.expected_total_amount, d.interest_rate_monthly_percent, d.start_date,
              d.target_payoff_date, d.status, d.notes, d.matching_rule, d.loan_type,
              d.override_automatic_schedule`;
const DEBT_FROM = `FROM debts d LEFT JOIN users su ON su.id = d.shared_with_user_id`;

// null userId = Household (every person's debts, unfiltered). Scoped to a
// person, a debt shows up whether they own it or are the shared-with party —
// is_owner distinguishes the two for the frontend.
export async function listDebts(userId: number | null = null): Promise<Debt[]> {
  const where = userId != null ? `WHERE d.user_id = ? OR d.shared_with_user_id = ?` : "";
  const result = await getDb().execute({
    sql: `SELECT ${DEBT_ROW_COLUMNS} ${DEBT_FROM} ${where} ORDER BY d.status ASC, d.start_date DESC`,
    args: userId != null ? [userId, userId] : [],
  });
  const rows = result.rows as unknown as DebtRow[];
  const debts: Debt[] = [];
  for (const row of rows) {
    const debt = await computeDebt(row);
    if (userId != null) debt.is_owner = row.user_id === userId;
    debts.push(debt);
  }
  return debts;
}

async function getDebtRow(id: number): Promise<DebtRow | null> {
  const result = await getDb().execute({
    sql: `SELECT ${DEBT_ROW_COLUMNS} ${DEBT_FROM} WHERE d.id = ?`,
    args: [id],
  });
  return (result.rows[0] as unknown as DebtRow | undefined) ?? null;
}

export async function debtExists(id: number): Promise<boolean> {
  const result = await getDb().execute({ sql: "SELECT id FROM debts WHERE id = ?", args: [id] });
  return result.rows.length > 0;
}

// All-or-nothing: a partial link (e.g. 3 of 5 transactions linked before a
// failure) would silently misrepresent what the caller asked for, since this
// is always meant as one logical "link these transactions" action.
export async function linkTransactionsToDebt(
  debtId: number,
  transactionIds: string[],
  role: "borrow" | "lend" | "pay_off"
): Promise<void> {
  if (transactionIds.length === 0) return;
  const tx = await getDb().transaction();
  try {
    for (const txId of transactionIds) {
      await tx.execute({
        sql: "INSERT OR REPLACE INTO debt_transactions (transaction_id, debt_id, role) VALUES (?, ?, ?)",
        args: [txId, debtId, role],
      });
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

export async function unlinkTransactionsFromDebt(
  debtId: number,
  transactionIds: string[]
): Promise<void> {
  const placeholders = transactionIds.map(() => "?").join(",");
  await getDb().execute({
    sql: `DELETE FROM debt_transactions WHERE debt_id = ? AND transaction_id IN (${placeholders})`,
    args: [debtId, ...transactionIds],
  });
}

// Feeds a whole other debt's computed principal into this (parent) debt's
// origin sum — e.g. the full Estudio Foz debt counts toward Juliana's 20%
// share, not just whichever installments happen to already be paid.
export async function linkDebtToDebt(parentDebtId: number, childDebtId: number): Promise<void> {
  if (parentDebtId === childDebtId) {
    throw new Error("A debt cannot be linked to itself.");
  }
  if (!(await getDebtRow(parentDebtId)) || !(await getDebtRow(childDebtId))) {
    throw new Error("Both debts must exist.");
  }
  await getDb().execute({
    sql: "INSERT OR REPLACE INTO debt_links (parent_debt_id, child_debt_id) VALUES (?, ?)",
    args: [parentDebtId, childDebtId],
  });
}

export async function unlinkDebtFromDebt(parentDebtId: number, childDebtId: number): Promise<void> {
  await getDb().execute({
    sql: "DELETE FROM debt_links WHERE parent_debt_id = ? AND child_debt_id = ?",
    args: [parentDebtId, childDebtId],
  });
}

export async function getDebtTransactions(id: number): Promise<DebtLinkedTransaction[]> {
  const result = await getDb().execute({
    sql: `SELECT t.id, t.account_id, t.date, t.description, t.amount, t.type, t.status, t.currency_code,
                 t.category_id, c.name as category_name, dt.role
          FROM debt_transactions dt
          JOIN transactions t ON t.id = dt.transaction_id
          LEFT JOIN categories c ON c.id = t.category_id
          WHERE dt.debt_id = ?
          ORDER BY t.date ASC`,
    args: [id],
  });
  const rows = result.rows as unknown as Omit<DebtLinkedTransaction, "interest" | "principal">[];

  const debtRow = await getDebtRow(id);
  const withBreakdown: DebtLinkedTransaction[] = rows.map((r) => ({
    ...r,
    interest: null,
    principal: null,
  }));

  if (debtRow?.interest_rate_monthly_percent != null) {
    const debt = await computeDebt(debtRow);
    const payOffRows = rows.filter((r) => r.role === "pay_off");
    const sim = simulateAmortization(
      debt.principal,
      debtRow.interest_rate_monthly_percent,
      debtRow.start_date,
      payOffRows.map((r) => ({ id: r.id, date: r.date, amount: Math.abs(r.amount) }))
    );
    const byId = new Map(sim.breakdown.map((b) => [b.id, b]));
    for (const row of withBreakdown) {
      const b = byId.get(row.id);
      if (b) {
        row.interest = b.interest;
        row.principal = b.principal;
      }
    }
  }

  return withBreakdown;
}

export interface NewDebtInput {
  name: string;
  direction: "owed_by_me" | "owed_to_me";
  counterparty?: string;
  userId: number;
  sharedWithUserId?: number;
  principalAmount?: number;
  splitPercentage?: number;
  expectedTotalAmount?: number;
  interestRateMonthlyPercent?: number;
  startDate: string;
  targetPayoffDate?: string;
  notes?: string;
  matchingRule?: string;
  loanType?: "price" | "sac";
}

// Write-only — inserts, returns the new row's id. Structural validation
// (required fields, direction enum, etc.) happens at the route boundary via
// the Zod schema in routes/debts.ts; this only enforces the one rule Zod
// can't (a DB-free cross-field check would be fine in Zod too, but keeping
// it here matches the "principalAmount xor splitPercentage" business rule
// living next to the math that depends on it).
export async function createDebt(input: NewDebtInput): Promise<number> {
  if (input.principalAmount == null && input.splitPercentage == null) {
    throw new Error("either principalAmount or splitPercentage is required");
  }
  const result = await getDb().execute({
    sql: `INSERT INTO debts (name, direction, counterparty, user_id, shared_with_user_id, principal_amount, split_percentage, expected_total_amount, interest_rate_monthly_percent, start_date, target_payoff_date, notes, matching_rule, loan_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.name,
      input.direction,
      input.counterparty ?? null,
      input.userId,
      input.sharedWithUserId ?? null,
      input.principalAmount ?? null,
      input.splitPercentage ?? null,
      input.expectedTotalAmount ?? null,
      input.interestRateMonthlyPercent ?? null,
      input.startDate,
      input.targetPayoffDate ?? null,
      input.notes ?? null,
      input.matchingRule ?? null,
      input.loanType ?? null,
    ],
  });
  return Number(result.lastInsertRowid);
}

export type DebtUpdateInput = Partial<{
  name: string;
  status: string;
  counterparty: string | null;
  sharedWithUserId: number | null;
  startDate: string;
  targetPayoffDate: string | null;
  principalAmount: number | null;
  splitPercentage: number | null;
  expectedTotalAmount: number | null;
  interestRateMonthlyPercent: number | null;
  notes: string | null;
  matchingRule: string | null;
  loanType: "price" | "sac" | null;
  overrideAutomaticSchedule: boolean;
}>;

export async function updateDebt(id: number, input: DebtUpdateInput): Promise<void> {
  if (!(await debtExists(id))) {
    throw new Error(`Debt ${id} not found`);
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    fields.push("name = ?");
    values.push(input.name);
  }
  if (input.counterparty !== undefined) {
    fields.push("counterparty = ?");
    values.push(input.counterparty);
  }
  if (input.sharedWithUserId !== undefined) {
    fields.push("shared_with_user_id = ?");
    values.push(input.sharedWithUserId);
  }
  if (input.status !== undefined) {
    fields.push("status = ?");
    values.push(input.status);
  }
  if (input.splitPercentage !== undefined) {
    fields.push("split_percentage = ?");
    values.push(input.splitPercentage);
  }
  if (input.targetPayoffDate !== undefined) {
    fields.push("target_payoff_date = ?");
    values.push(input.targetPayoffDate);
  }
  if (input.principalAmount !== undefined) {
    fields.push("principal_amount = ?");
    values.push(input.principalAmount);
  }
  if (input.expectedTotalAmount !== undefined) {
    fields.push("expected_total_amount = ?");
    values.push(input.expectedTotalAmount);
  }
  if (input.interestRateMonthlyPercent !== undefined) {
    fields.push("interest_rate_monthly_percent = ?");
    values.push(input.interestRateMonthlyPercent);
  }
  if (input.notes !== undefined) {
    fields.push("notes = ?");
    values.push(input.notes);
  }
  if (input.matchingRule !== undefined) {
    fields.push("matching_rule = ?");
    values.push(input.matchingRule);
  }
  if (input.startDate !== undefined) {
    fields.push("start_date = ?");
    values.push(input.startDate);
  }
  if (input.loanType !== undefined) {
    fields.push("loan_type = ?");
    values.push(input.loanType);
  }
  if (input.overrideAutomaticSchedule !== undefined) {
    fields.push("override_automatic_schedule = ?");
    values.push(input.overrideAutomaticSchedule ? 1 : 0);
  }
  if (fields.length > 0) {
    values.push(id);
    await getDb().execute({
      sql: `UPDATE debts SET ${fields.join(", ")} WHERE id = ?`,
      args: values as [],
    });
  }
}

// All-or-nothing across the three dependent tables — a crash or error
// between these deletes would otherwise leave orphaned debt_transactions/
// debt_links rows pointing at a debt that no longer exists.
export async function deleteDebt(id: number): Promise<void> {
  const tx = await getDb().transaction();
  try {
    await tx.execute({ sql: "DELETE FROM debt_transactions WHERE debt_id = ?", args: [id] });
    await tx.execute({
      sql: "DELETE FROM debt_links WHERE parent_debt_id = ? OR child_debt_id = ?",
      args: [id, id],
    });
    await tx.execute({ sql: "DELETE FROM debts WHERE id = ?", args: [id] });
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}
