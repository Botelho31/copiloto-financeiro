import { Elysia } from "elysia";
import type { Bill } from "shared";
import { db } from "../db";

const CADENCES = new Set(["weekly", "monthly", "quarterly", "yearly", "once"]);

interface BillRow {
  id: number;
  name: string;
  category_id: number | null;
  category_name: string | null;
  category_kind: string | null;
  expected_amount: number;
  cadence: string;
  next_due_date: string | null;
  recurrence_start_date: string | null;
  recurrence_end_date: string | null;
  is_card_expense: number;
  source: string;
  confirmed: number;
  active: number;
  debt_id: number | null;
  debt_name: string | null;
}

export function listBills(): Bill[] {
  const rows = db
    .query(
      `SELECT b.id, b.name, b.category_id, c.name as category_name, c.kind as category_kind,
              b.expected_amount, b.cadence, b.next_due_date,
              b.recurrence_start_date, b.recurrence_end_date, b.is_card_expense,
              b.source, b.confirmed, b.active, b.debt_id, d.name as debt_name
       FROM recurring_bills b
       LEFT JOIN categories c ON c.id = b.category_id
       LEFT JOIN debts d ON d.id = b.debt_id
       ORDER BY b.confirmed ASC, b.next_due_date ASC`
    )
    .all() as BillRow[];

  return rows.map((r) => ({
    ...r,
    cadence: r.cadence as Bill["cadence"],
    is_card_expense: r.is_card_expense === 1,
    confirmed: r.confirmed === 1,
    active: r.active === 1,
  }));
}

function debtExists(id: number): boolean {
  return db.query("SELECT id FROM debts WHERE id = ?").get(id) != null;
}

export const billsRoutes = new Elysia({ prefix: "/api/bills" })
  .get("/", () => listBills())
  .post("/", ({ body, set }) => {
    const input = body as {
      name?: string;
      categoryId?: number;
      expectedAmount?: number;
      cadence?: string;
      nextDueDate?: string;
      recurrenceStartDate?: string;
      recurrenceEndDate?: string;
      isCardExpense?: boolean;
      debtId?: number;
    };
    if (!input.name || !input.expectedAmount || !input.cadence) {
      set.status = 400;
      return { error: "name, expectedAmount and cadence are required" };
    }
    if (!CADENCES.has(input.cadence)) {
      set.status = 400;
      return { error: "cadence must be weekly, monthly, quarterly, yearly or once" };
    }
    if (input.debtId != null && !debtExists(input.debtId)) {
      set.status = 400;
      return { error: "debtId does not match an existing debt" };
    }

    db.query(
      `INSERT INTO recurring_bills (name, category_id, expected_amount, cadence, next_due_date, recurrence_start_date, recurrence_end_date, is_card_expense, debt_id, source, confirmed, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 1, 1)`
    ).run(
      input.name,
      input.categoryId ?? null,
      input.expectedAmount,
      input.cadence,
      input.nextDueDate ?? null,
      input.recurrenceStartDate ?? null,
      input.recurrenceEndDate ?? null,
      input.isCardExpense ? 1 : 0,
      input.debtId ?? null
    );
    return listBills();
  })
  .patch("/:id", ({ params, body, set }) => {
    const id = Number(params.id);
    const existing = db.query("SELECT id FROM recurring_bills WHERE id = ?").get(id);
    if (!existing) {
      set.status = 404;
      return { error: "not found" };
    }

    const input = body as Partial<{
      name: string;
      categoryId: number | null;
      expectedAmount: number;
      cadence: string;
      nextDueDate: string | null;
      recurrenceStartDate: string | null;
      recurrenceEndDate: string | null;
      isCardExpense: boolean;
      confirmed: boolean;
      active: boolean;
      debtId: number | null;
    }>;

    if (input.cadence !== undefined && !CADENCES.has(input.cadence)) {
      set.status = 400;
      return { error: "cadence must be weekly, monthly, quarterly, yearly or once" };
    }
    if (input.debtId != null && !debtExists(input.debtId)) {
      set.status = 400;
      return { error: "debtId does not match an existing debt" };
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    if (input.name !== undefined) {
      fields.push("name = ?");
      values.push(input.name);
    }
    if (input.categoryId !== undefined) {
      fields.push("category_id = ?");
      values.push(input.categoryId);
    }
    if (input.expectedAmount !== undefined) {
      fields.push("expected_amount = ?");
      values.push(input.expectedAmount);
    }
    if (input.cadence !== undefined) {
      fields.push("cadence = ?");
      values.push(input.cadence);
    }
    if (input.nextDueDate !== undefined) {
      fields.push("next_due_date = ?");
      values.push(input.nextDueDate);
    }
    if (input.recurrenceStartDate !== undefined) {
      fields.push("recurrence_start_date = ?");
      values.push(input.recurrenceStartDate);
    }
    if (input.recurrenceEndDate !== undefined) {
      fields.push("recurrence_end_date = ?");
      values.push(input.recurrenceEndDate);
    }
    if (input.isCardExpense !== undefined) {
      fields.push("is_card_expense = ?");
      values.push(input.isCardExpense ? 1 : 0);
    }
    if (input.confirmed !== undefined) {
      fields.push("confirmed = ?");
      values.push(input.confirmed ? 1 : 0);
    }
    if (input.active !== undefined) {
      fields.push("active = ?");
      values.push(input.active ? 1 : 0);
    }
    if (input.debtId !== undefined) {
      fields.push("debt_id = ?");
      values.push(input.debtId);
    }

    if (fields.length > 0) {
      values.push(id);
      db.query(`UPDATE recurring_bills SET ${fields.join(", ")} WHERE id = ?`).run(
        ...(values as [])
      );
    }
    return listBills();
  })
  .delete("/:id", ({ params }) => {
    const id = Number(params.id);
    db.query("DELETE FROM recurring_bill_matches WHERE recurring_bill_id = ?").run(id);
    db.query("DELETE FROM recurring_bills WHERE id = ?").run(id);
    return listBills();
  });
