import { Elysia } from "elysia";
import { z } from "zod";
import type { Goal } from "shared";
import { getDb } from "../db";
import { parseUserId } from "../lib/scope";
import { computeProjection, currentBalance, investmentsTotal } from "../services/projectionEngine";

interface GoalRow {
  id: number;
  name: string;
  target_amount: number;
  target_date: string;
}

function monthsUntil(targetDate: string): number {
  const now = new Date();
  const target = new Date(targetDate);
  const months =
    (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  return Math.max(1, months);
}

async function computeGoal(row: GoalRow, userId: number | null): Promise<Goal> {
  // Includes investment holdings alongside cash — a goal is about total net
  // worth reaching a number, not just what's liquid in the bank. computeProjection's
  // own startingBalance/months[].balance already fold investmentsTotal in
  // (see projectionEngine.ts), so it's read once here, not added again on
  // top of finalMonth.balance.
  const currentNetWorth = (await currentBalance(userId)) + (await investmentsTotal(userId));

  const months = monthsUntil(row.target_date);
  const requiredMonthlySavings = (row.target_amount - currentNetWorth) / months;

  // Project all the way out to this goal's own target date, not a fixed
  // window — a flat few-month average can't tell "permanently behind" apart
  // from "one lumpy month" (e.g. a large one-time expense followed by a full
  // recovery), and a goal further out than the window would be judged by a
  // rate that has nothing to do with its own horizon. Deriving the rate from
  // the actual projected balance at the target date keeps this consistent
  // with what the balance chart visually shows.
  const projection = await computeProjection({ horizonMonths: months, userId });
  const finalMonth = projection.months[projection.months.length - 1];
  const projectedNetWorthAtTarget = finalMonth?.balance ?? currentNetWorth;
  const projectedMonthlySavings = (projectedNetWorthAtTarget - currentNetWorth) / months;

  return {
    ...row,
    required_monthly_savings: requiredMonthlySavings,
    projected_monthly_savings: projectedMonthlySavings,
    on_track: projectedNetWorthAtTarget >= row.target_amount,
  };
}

// null userId = Household (goals from every person combined, each still
// projected against their own net worth — a goal always belongs to one person).
export async function listGoals(userId: number | null = null): Promise<Goal[]> {
  const where = userId != null ? "WHERE user_id = ?" : "";
  const result = await getDb().execute({
    sql: `SELECT id, name, target_amount, target_date FROM goals ${where} ORDER BY target_date ASC`,
    args: userId != null ? [userId] : [],
  });
  const rows = result.rows as unknown as GoalRow[];
  const goals: Goal[] = [];
  for (const row of rows) goals.push(await computeGoal(row, userId));
  return goals;
}

export const NewGoalBody = z.object({
  name: z.string().min(1),
  targetAmount: z.number(),
  targetDate: z.string().min(1),
  userId: z.number().int(),
});
export type NewGoalInput = z.infer<typeof NewGoalBody>;

// Write-only — validates and inserts, returns the new row's id. Structural
// validation happens via NewGoalBody at the REST route boundary; the MCP
// create_goal tool has its own Zod schema (same shape here, kept separate
// since the MCP tool's schema also carries LLM-facing descriptions).
export async function createGoal(input: NewGoalInput): Promise<number> {
  const result = await getDb().execute({
    sql: "INSERT INTO goals (name, target_amount, target_date, user_id) VALUES (?, ?, ?, ?)",
    args: [input.name, input.targetAmount, input.targetDate, input.userId],
  });
  return Number(result.lastInsertRowid);
}

export const GoalUpdateBody = z.object({
  name: z.string().optional(),
  targetAmount: z.number().optional(),
  targetDate: z.string().optional(),
});
export type GoalUpdateInput = z.infer<typeof GoalUpdateBody>;

export async function updateGoal(id: number, input: GoalUpdateInput): Promise<void> {
  const db = getDb();
  const existingResult = await db.execute({ sql: "SELECT id FROM goals WHERE id = ?", args: [id] });
  if (existingResult.rows.length === 0) {
    throw new Error(`Goal ${id} not found`);
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    fields.push("name = ?");
    values.push(input.name);
  }
  if (input.targetAmount !== undefined) {
    fields.push("target_amount = ?");
    values.push(input.targetAmount);
  }
  if (input.targetDate !== undefined) {
    fields.push("target_date = ?");
    values.push(input.targetDate);
  }
  if (fields.length > 0) {
    values.push(id);
    await db.execute({
      sql: `UPDATE goals SET ${fields.join(", ")} WHERE id = ?`,
      args: values as [],
    });
  }
}

export async function deleteGoal(id: number): Promise<void> {
  await getDb().execute({ sql: "DELETE FROM goals WHERE id = ?", args: [id] });
}

export const goalsRoutes = new Elysia({ prefix: "/api/goals" })
  .get("/", ({ query }) => listGoals(parseUserId(query)))
  .post(
    "/",
    async ({ body, set, query }) => {
      try {
        await createGoal(body);
        return listGoals(parseUserId(query));
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: NewGoalBody }
  )
  .patch(
    "/:id",
    async ({ params, body, set, query }) => {
      try {
        await updateGoal(Number(params.id), body);
        return listGoals(parseUserId(query));
      } catch (error) {
        set.status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: GoalUpdateBody }
  )
  .delete("/:id", async ({ params, query }) => {
    await deleteGoal(Number(params.id));
    return listGoals(parseUserId(query));
  });
