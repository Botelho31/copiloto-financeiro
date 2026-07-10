import { Elysia } from "elysia";
import type { Bill, Debt, DebtLinkedTransaction, DebtPaymentPlan } from "shared";
import {
  addMonthsIso,
  billAppliesToMonth,
  localMonthDate,
  monthlyEquivalentAmount,
  pricePayment,
  sacPaymentForMonth,
  simulateAmortization,
} from "shared";
import { db } from "../db";

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
function fetchLinkedBills(debtId: number): LinkedBillRow[] {
  return db
    .query(
      `SELECT id, name, expected_amount, cadence, next_due_date, recurrence_start_date, recurrence_end_date
       FROM recurring_bills
       WHERE debt_id = ? AND confirmed = 1 AND active = 1 AND is_card_expense = 0`
    )
    .all(debtId) as LinkedBillRow[];
}

interface DebtRow {
  id: number;
  name: string;
  direction: "owed_by_me" | "owed_to_me";
  counterparty: string | null;
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
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
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
function computePaymentPlan(
  row: DebtRow,
  principal: number,
  remaining: number,
  linkedBills: LinkedBillRow[]
): DebtPaymentPlan {
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
            : sacPaymentForMonth(principal, row.interest_rate_monthly_percent, termMonths, monthOfLoan),
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

  const amounts = (
    db
      .query(
        `SELECT ABS(t.amount) as amount
         FROM debt_transactions dt
         JOIN transactions t ON t.id = dt.transaction_id
         WHERE dt.debt_id = ? AND dt.role = 'pay_off'`
      )
      .all(row.id) as { amount: number }[]
  ).map((r) => r.amount);

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

// The same date a chart or "finish date" card stat should ever show — walked
// forward from payment_plan (never re-derived independently), so this can
// never disagree with what the projection engine's own month-by-month debt
// lines converge on. A loan's extra-amortization bills are folded in with the
// exact same shared remaining-balance cap projectionEngine.ts uses (the fixed
// installment's own interest/amortization split never changes because of an
// extra payment — the contract doesn't recompute itself — but cumulative
// cash toward the debt, installment plus every extra bill, is capped against
// `remaining` and trims/stops the schedule the moment it's exhausted).
function computeProjectedFinishDate(
  row: DebtRow,
  plan: DebtPaymentPlan,
  remaining: number,
  linkedBills: LinkedBillRow[]
): { finishDate: string | null; remainingInterest: number | null } {
  if (row.status !== "active") return { finishDate: null, remainingInterest: null };
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = row.start_date > today ? row.start_date : today;
  if (remaining <= 0.005) return { finishDate: fromDate, remainingInterest: 0 };

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

    const fixedPayment = plan.loan_type === "price" ? pricePayment(remaining, rate, termCeiling) : null;
    const fixedAmortization = plan.loan_type === "sac" ? remaining / termCeiling : null;
    let scheduleBalance = remaining;
    let paidSoFar = 0;
    let totalInterest = 0;
    let finishDate: string | null = null;
    for (let month = 1; month <= termCeiling && paidSoFar < remaining - 0.005; month++) {
      const targetMonth = localMonthDate(fromDate, month - 1);
      const interest = scheduleBalance * r;
      const amort = fixedPayment != null ? fixedPayment - interest : fixedAmortization!;
      const rawPayment = interest + amort;
      scheduleBalance = Math.max(0, scheduleBalance - amort);
      const cappedPayment = Math.min(rawPayment, remaining - paidSoFar);
      if (cappedPayment <= 0.005) break;
      const interestThisMonth = cappedPayment < rawPayment ? interest * (cappedPayment / rawPayment) : interest;
      paidSoFar += cappedPayment;
      totalInterest += interestThisMonth;
      if (paidSoFar < remaining - 0.005) {
        const extra = linkedBills.reduce((sum, b) => {
          const info = {
            cadence: b.cadence as Bill["cadence"],
            nextDueDate: b.next_due_date,
            recurrenceStartDate: b.recurrence_start_date,
            recurrenceEndDate: b.recurrence_end_date,
          };
          if (!billAppliesToMonth(info, targetMonth)) return sum;
          return sum + monthlyEquivalentAmount({ cadence: b.cadence as Bill["cadence"], expectedAmount: b.expected_amount });
        }, 0);
        paidSoFar += Math.min(extra, remaining - paidSoFar);
      }
      if (paidSoFar >= remaining - 0.005) finishDate = addMonthsIso(fromDate, month - 1);
    }
    return { finishDate, remainingInterest: finishDate != null ? totalInterest : null };
  }

  if (plan.source === "combined") {
    const monthly =
      plan.bills.reduce(
        (sum, b) => sum + monthlyEquivalentAmount({ cadence: b.cadence, expectedAmount: b.amount }),
        0
      ) + (plan.automatic?.monthly_amount ?? 0);
    if (monthly <= 0) return { finishDate: null, remainingInterest: null };
    const rate = row.interest_rate_monthly_percent;
    const r = rate != null && rate > 0 ? rate / 100 : 0;
    if (r > 0 && monthly <= remaining * r) return { finishDate: null, remainingInterest: null };
    let balance = remaining;
    let totalInterest = 0;
    let months = 0;
    for (; months < MAX_FINISH_MONTHS && balance > 0.005; months++) {
      totalInterest += balance * r;
      balance = Math.max(0, balance * (1 + r) - monthly);
    }
    if (balance > 0.005) return { finishDate: null, remainingInterest: null };
    return { finishDate: addMonthsIso(fromDate, months), remainingInterest: r > 0 ? totalInterest : null };
  }

  return { finishDate: null, remainingInterest: null };
}

function computeDebt(row: DebtRow, visiting: Set<number> = new Set()): Debt {
  const txOriginSum = (
    db
      .query(
        `SELECT COALESCE(SUM(ABS(t.amount)), 0) as total
         FROM debt_transactions dt
         JOIN transactions t ON t.id = dt.transaction_id
         WHERE dt.debt_id = ? AND dt.role IN ('borrow', 'lend')`
      )
      .get(row.id) as { total: number }
  ).total;

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
  const linkedDebts = (
    db.query("SELECT child_debt_id FROM debt_links WHERE parent_debt_id = ?").all(row.id) as {
      child_debt_id: number;
    }[]
  )
    .map(({ child_debt_id }) => {
      if (visiting.has(child_debt_id)) return null;
      const childRow = getDebtRow(child_debt_id);
      if (!childRow) return null;
      const childComputed = computeDebt(childRow, nextVisiting);
      // The displayed principal is always the real figure — only whether it
      // counts toward *this* debt's origin sum depends on whether the child
      // has actually started.
      return {
        id: childRow.id,
        name: childRow.name,
        principal: childComputed.principal,
        countsTowardOrigin: childRow.start_date <= today,
      };
    })
    .filter(
      (d): d is { id: number; name: string; principal: number; countsTowardOrigin: boolean } =>
        d !== null
    );

  const originSum =
    txOriginSum +
    linkedDebts.filter((d) => d.countsTowardOrigin).reduce((sum, d) => sum + d.principal, 0);

  const totalPaid = (
    db
      .query(
        `SELECT COALESCE(SUM(ABS(t.amount)), 0) as total
         FROM debt_transactions dt
         JOIN transactions t ON t.id = dt.transaction_id
         WHERE dt.debt_id = ? AND dt.role = 'pay_off'`
      )
      .get(row.id) as { total: number }
  ).total;

  const transactionCount = (
    db.query("SELECT COUNT(*) as n FROM debt_transactions WHERE debt_id = ?").get(row.id) as {
      n: number;
    }
  ).n;

  const principal =
    row.split_percentage != null
      ? originSum * (row.split_percentage / 100)
      : (row.principal_amount ?? originSum);

  if (row.interest_rate_monthly_percent != null && principal > 0) {
    const payments = db
      .query(
        `SELECT t.id, t.date, ABS(t.amount) as amount
         FROM debt_transactions dt
         JOIN transactions t ON t.id = dt.transaction_id
         WHERE dt.debt_id = ? AND dt.role = 'pay_off'`
      )
      .all(row.id) as { id: string; date: string; amount: number }[];

    const sim = simulateAmortization(
      principal,
      row.interest_rate_monthly_percent,
      row.start_date,
      payments
    );

    const linkedBills = fetchLinkedBills(row.id);
    const plan = computePaymentPlan(row, principal, sim.currentPayoffBalance, linkedBills);
    const { finishDate, remainingInterest } = computeProjectedFinishDate(
      row,
      plan,
      sim.currentPayoffBalance,
      linkedBills
    );

    return {
      ...row,
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
    };
  }

  const target = row.expected_total_amount ?? principal;
  const remaining = target - totalPaid;
  const percentComplete = target > 0 ? totalPaid / target : 0;
  const interestPaidSoFar =
    row.expected_total_amount != null && row.expected_total_amount > 0
      ? totalPaid * ((row.expected_total_amount - principal) / row.expected_total_amount)
      : null;

  const linkedBills = fetchLinkedBills(row.id);
  const plan = computePaymentPlan(row, principal, remaining, linkedBills);
  const { finishDate, remainingInterest } = computeProjectedFinishDate(row, plan, remaining, linkedBills);

  return {
    ...row,
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
  };
}

const DEBT_ROW_COLUMNS = `id, name, direction, counterparty, principal_amount, split_percentage,
              expected_total_amount, interest_rate_monthly_percent, start_date,
              target_payoff_date, status, notes, matching_rule, loan_type, override_automatic_schedule`;

export function listDebts(): Debt[] {
  const rows = db
    .query(`SELECT ${DEBT_ROW_COLUMNS} FROM debts ORDER BY status ASC, start_date DESC`)
    .all() as DebtRow[];
  return rows.map((row) => computeDebt(row));
}

function getDebtRow(id: number): DebtRow | null {
  return db.query(`SELECT ${DEBT_ROW_COLUMNS} FROM debts WHERE id = ?`).get(id) as DebtRow | null;
}

export function linkTransactionsToDebt(
  debtId: number,
  transactionIds: string[],
  role: "borrow" | "lend" | "pay_off"
): void {
  for (const txId of transactionIds) {
    db.query(
      "INSERT OR REPLACE INTO debt_transactions (transaction_id, debt_id, role) VALUES (?, ?, ?)"
    ).run(txId, debtId, role);
  }
}

// Feeds a whole other debt's computed principal into this (parent) debt's
// origin sum — e.g. the full Estudio Foz debt counts toward Juliana's 20%
// share, not just whichever installments happen to already be paid.
export function linkDebtToDebt(parentDebtId: number, childDebtId: number): void {
  if (parentDebtId === childDebtId) {
    throw new Error("A debt cannot be linked to itself.");
  }
  if (!getDebtRow(parentDebtId) || !getDebtRow(childDebtId)) {
    throw new Error("Both debts must exist.");
  }
  db.query(
    "INSERT OR REPLACE INTO debt_links (parent_debt_id, child_debt_id) VALUES (?, ?)"
  ).run(parentDebtId, childDebtId);
}

export function unlinkDebtFromDebt(parentDebtId: number, childDebtId: number): void {
  db.query(
    "DELETE FROM debt_links WHERE parent_debt_id = ? AND child_debt_id = ?"
  ).run(parentDebtId, childDebtId);
}

export function getDebtTransactions(id: number): DebtLinkedTransaction[] {
  const rows = db
    .query(
      `SELECT t.id, t.account_id, t.date, t.description, t.amount, t.type, t.status, t.currency_code,
              t.category_id, c.name as category_name, dt.role
       FROM debt_transactions dt
       JOIN transactions t ON t.id = dt.transaction_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE dt.debt_id = ?
       ORDER BY t.date ASC`
    )
    .all(id) as Omit<DebtLinkedTransaction, "interest" | "principal">[];

  const debtRow = getDebtRow(id);
  const withBreakdown: DebtLinkedTransaction[] = rows.map((r) => ({
    ...r,
    interest: null,
    principal: null,
  }));

  if (debtRow?.interest_rate_monthly_percent != null) {
    const debt = computeDebt(debtRow);
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

export const debtsRoutes = new Elysia({ prefix: "/api/debts" })
  .get("/", () => listDebts())
  .get("/:id/transactions", ({ params }) => getDebtTransactions(Number(params.id)))
  .post("/", ({ body, set }) => {
    const input = body as {
      name?: string;
      direction?: string;
      counterparty?: string;
      principalAmount?: number;
      splitPercentage?: number;
      expectedTotalAmount?: number;
      interestRateMonthlyPercent?: number;
      startDate?: string;
      targetPayoffDate?: string;
      notes?: string;
      matchingRule?: string;
      loanType?: "price" | "sac";
    };
    if (!input.name || !input.direction || !input.startDate) {
      set.status = 400;
      return { error: "name, direction and startDate are required" };
    }
    if (input.direction !== "owed_by_me" && input.direction !== "owed_to_me") {
      set.status = 400;
      return { error: "direction must be owed_by_me or owed_to_me" };
    }
    if (input.principalAmount == null && input.splitPercentage == null) {
      set.status = 400;
      return { error: "either principalAmount or splitPercentage is required" };
    }
    db.query(
      `INSERT INTO debts (name, direction, counterparty, principal_amount, split_percentage, expected_total_amount, interest_rate_monthly_percent, start_date, target_payoff_date, notes, matching_rule, loan_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.name,
      input.direction,
      input.counterparty ?? null,
      input.principalAmount ?? null,
      input.splitPercentage ?? null,
      input.expectedTotalAmount ?? null,
      input.interestRateMonthlyPercent ?? null,
      input.startDate,
      input.targetPayoffDate ?? null,
      input.notes ?? null,
      input.matchingRule ?? null,
      input.loanType ?? null
    );
    return listDebts();
  })
  .patch("/:id", ({ params, body, set }) => {
    const id = Number(params.id);
    const existing = db.query("SELECT id FROM debts WHERE id = ?").get(id);
    if (!existing) {
      set.status = 404;
      return { error: "not found" };
    }
    const input = body as Partial<{
      name: string;
      status: string;
      startDate: string;
      targetPayoffDate: string | null;
      principalAmount: number | null;
      expectedTotalAmount: number | null;
      interestRateMonthlyPercent: number | null;
      notes: string | null;
      matchingRule: string | null;
      loanType: "price" | "sac" | null;
      overrideAutomaticSchedule: boolean;
    }>;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (input.name !== undefined) {
      fields.push("name = ?");
      values.push(input.name);
    }
    if (input.status !== undefined) {
      fields.push("status = ?");
      values.push(input.status);
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
      db.query(`UPDATE debts SET ${fields.join(", ")} WHERE id = ?`).run(...(values as []));
    }
    return listDebts();
  })
  .delete("/:id", ({ params }) => {
    const id = Number(params.id);
    db.query("DELETE FROM debt_transactions WHERE debt_id = ?").run(id);
    db.query("DELETE FROM debt_links WHERE parent_debt_id = ? OR child_debt_id = ?").run(id, id);
    db.query("DELETE FROM debts WHERE id = ?").run(id);
    return listDebts();
  })
  .post("/:id/link", ({ params, body, set }) => {
    const id = Number(params.id);
    const input = body as { transactionIds?: string[]; role?: string };
    if (!input.transactionIds?.length || !input.role) {
      set.status = 400;
      return { error: "transactionIds and role are required" };
    }
    if (!["borrow", "lend", "pay_off"].includes(input.role)) {
      set.status = 400;
      return { error: "role must be borrow, lend or pay_off" };
    }
    linkTransactionsToDebt(id, input.transactionIds, input.role as "borrow" | "lend" | "pay_off");
    return listDebts();
  })
  .post("/:id/unlink", ({ params, body, set }) => {
    const id = Number(params.id);
    const input = body as { transactionIds?: string[] };
    if (!input.transactionIds?.length) {
      set.status = 400;
      return { error: "transactionIds are required" };
    }
    const placeholders = input.transactionIds.map(() => "?").join(",");
    db.query(
      `DELETE FROM debt_transactions WHERE debt_id = ? AND transaction_id IN (${placeholders})`
    ).run(id, ...input.transactionIds);
    return listDebts();
  })
  .post("/:id/link-debt", ({ params, body, set }) => {
    const id = Number(params.id);
    const input = body as { childDebtId?: number };
    if (!input.childDebtId) {
      set.status = 400;
      return { error: "childDebtId is required" };
    }
    try {
      linkDebtToDebt(id, input.childDebtId);
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? error.message : String(error) };
    }
    return listDebts();
  })
  .post("/:id/unlink-debt", ({ params, body, set }) => {
    const id = Number(params.id);
    const input = body as { childDebtId?: number };
    if (!input.childDebtId) {
      set.status = 400;
      return { error: "childDebtId is required" };
    }
    unlinkDebtFromDebt(id, input.childDebtId);
    return listDebts();
  });
