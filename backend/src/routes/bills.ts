import { Elysia } from "elysia";
import { z } from "zod";
import type { Bill } from "shared";
import { getDb } from "../db";
import { parseUserId } from "../lib/scope";
import { debtExists } from "../services/debts";

const CADENCES = z.enum(["weekly", "monthly", "quarterly", "yearly", "once"]);

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

// null userId = Household (every person's bills combined).
export async function listBills(userId: number | null = null): Promise<Bill[]> {
  const where = userId != null ? "WHERE b.user_id = ?" : "";
  const result = await getDb().execute({
    sql: `SELECT b.id, b.name, b.category_id, c.name as category_name, c.kind as category_kind,
                 b.expected_amount, b.cadence, b.next_due_date,
                 b.recurrence_start_date, b.recurrence_end_date, b.is_card_expense,
                 b.source, b.confirmed, b.active, b.debt_id, d.name as debt_name
          FROM recurring_bills b
          LEFT JOIN categories c ON c.id = b.category_id
          LEFT JOIN debts d ON d.id = b.debt_id
          ${where}
          ORDER BY b.confirmed ASC, b.next_due_date ASC`,
    args: userId != null ? [userId] : [],
  });
  const rows = result.rows as unknown as BillRow[];

  return rows.map((r) => ({
    ...r,
    cadence: r.cadence as Bill["cadence"],
    is_card_expense: r.is_card_expense === 1,
    confirmed: r.confirmed === 1,
    active: r.active === 1,
  }));
}

async function billExists(id: number): Promise<boolean> {
  const result = await getDb().execute({
    sql: "SELECT id FROM recurring_bills WHERE id = ?",
    args: [id],
  });
  return result.rows.length > 0;
}

async function validateDebtId(debtId: number | null | undefined): Promise<void> {
  if (debtId != null && !(await debtExists(debtId))) {
    throw new Error("debtId does not match an existing debt");
  }
}

export const NewBillBody = z.object({
  name: z.string().min(1),
  userId: z.number().int(),
  categoryId: z.number().int().optional(),
  expectedAmount: z.number(),
  cadence: CADENCES,
  nextDueDate: z.string().optional(),
  recurrenceStartDate: z.string().optional(),
  recurrenceEndDate: z.string().optional(),
  isCardExpense: z.boolean().optional(),
  debtId: z.number().int().optional(),
});
export type NewBillInput = z.infer<typeof NewBillBody>;

// Write-only — validates and inserts, returns the new row's id. Shared by
// the REST route and the MCP create_bill tool, which each decide their own
// response shape (the REST route returns the caller's scoped list; the MCP
// tool always returns the full list) rather than this function guessing.
// Structural validation (required fields, cadence enum) happens via
// NewBillBody at the REST route boundary — the MCP tool has its own Zod
// schema (different wire shape: categoryName/debtName instead of ids), so
// this function still validates debtId's existence itself since both
// callers need that DB-dependent check.
export async function createBill(input: NewBillInput): Promise<number> {
  await validateDebtId(input.debtId);

  const result = await getDb().execute({
    sql: `INSERT INTO recurring_bills (name, user_id, category_id, expected_amount, cadence, next_due_date, recurrence_start_date, recurrence_end_date, is_card_expense, debt_id, source, confirmed, active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 1, 1)`,
    args: [
      input.name,
      input.userId,
      input.categoryId ?? null,
      input.expectedAmount,
      input.cadence,
      input.nextDueDate ?? null,
      input.recurrenceStartDate ?? null,
      input.recurrenceEndDate ?? null,
      input.isCardExpense ? 1 : 0,
      input.debtId ?? null,
    ],
  });
  return Number(result.lastInsertRowid);
}

export const BillUpdateBody = z.object({
  name: z.string().optional(),
  categoryId: z.number().int().nullable().optional(),
  expectedAmount: z.number().optional(),
  cadence: CADENCES.optional(),
  nextDueDate: z.string().nullable().optional(),
  recurrenceStartDate: z.string().nullable().optional(),
  recurrenceEndDate: z.string().nullable().optional(),
  isCardExpense: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  active: z.boolean().optional(),
  debtId: z.number().int().nullable().optional(),
});
export type BillUpdateInput = z.infer<typeof BillUpdateBody>;

export async function updateBill(id: number, input: BillUpdateInput): Promise<void> {
  if (!(await billExists(id))) {
    throw new Error(`Bill ${id} not found`);
  }
  await validateDebtId(input.debtId);

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
    await getDb().execute({
      sql: `UPDATE recurring_bills SET ${fields.join(", ")} WHERE id = ?`,
      args: values as [],
    });
  }
}

// Both deletes as one unit — an interrupted delete should never leave an
// orphaned recurring_bill_matches row pointing at a bill that no longer
// exists.
export async function deleteBill(id: number): Promise<void> {
  const tx = await getDb().transaction();
  try {
    await tx.execute({
      sql: "DELETE FROM recurring_bill_matches WHERE recurring_bill_id = ?",
      args: [id],
    });
    await tx.execute({ sql: "DELETE FROM recurring_bills WHERE id = ?", args: [id] });
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

export const billsRoutes = new Elysia({ prefix: "/api/bills" })
  .get("/", ({ query }) => listBills(parseUserId(query)))
  .post(
    "/",
    async ({ body, set, query }) => {
      try {
        await createBill(body);
        return listBills(parseUserId(query));
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: NewBillBody }
  )
  .patch(
    "/:id",
    async ({ params, body, set, query }) => {
      try {
        await updateBill(Number(params.id), body);
        return listBills(parseUserId(query));
      } catch (error) {
        set.status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: BillUpdateBody }
  )
  .delete("/:id", async ({ params, query }) => {
    await deleteBill(Number(params.id));
    return listBills(parseUserId(query));
  });
