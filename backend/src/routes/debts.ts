import { Elysia } from "elysia";
import type { Debt, DebtLinkedTransaction } from "shared";
import { simulateAmortization } from "shared";
import { db } from "../db";

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
  // Guard against cycles (A links to B links to A) since two debts can now
  // reference each other.
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
      return { id: childRow.id, name: childRow.name, principal: childComputed.principal };
    })
    .filter((d): d is { id: number; name: string; principal: number } => d !== null);

  const originSum = txOriginSum + linkedDebts.reduce((sum, d) => sum + d.principal, 0);

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

    return {
      ...row,
      principal,
      total_paid: totalPaid,
      remaining: sim.currentPayoffBalance,
      percent_complete: totalPaid > 0 ? totalPaid / (totalPaid + sim.currentPayoffBalance) : 0,
      interest_paid_so_far: sim.totalInterestPaid,
      remaining_principal: sim.principalRemaining,
      remaining_interest: sim.interestAccruedSinceLastPayment,
      transaction_count: transactionCount,
      linked_debts: linkedDebts,
    };
  }

  const target = row.expected_total_amount ?? principal;
  const remaining = target - totalPaid;
  const percentComplete = target > 0 ? totalPaid / target : 0;
  const interestPaidSoFar =
    row.expected_total_amount != null && row.expected_total_amount > 0
      ? totalPaid * ((row.expected_total_amount - principal) / row.expected_total_amount)
      : null;

  return {
    ...row,
    principal,
    total_paid: totalPaid,
    remaining,
    percent_complete: percentComplete,
    interest_paid_so_far: interestPaidSoFar,
    remaining_principal: null,
    remaining_interest: null,
    transaction_count: transactionCount,
    linked_debts: linkedDebts,
  };
}

const DEBT_ROW_COLUMNS = `id, name, direction, counterparty, principal_amount, split_percentage,
              expected_total_amount, interest_rate_monthly_percent, start_date,
              target_payoff_date, status, notes, matching_rule, loan_type`;

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
