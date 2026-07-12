import { Elysia } from "elysia";
import { z } from "zod";
import type { Goal } from "shared";
import { db } from "../db";
import { parseUserId } from "../lib/scope";
import { computeProjection, currentBalance } from "../services/projectionEngine";

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

function computeGoal(row: GoalRow, userId: number | null): Goal {
  // Includes investment holdings alongside cash — a goal is about total net
  // worth reaching a number, not just what's liquid in the bank.
  const investmentWhere = userId != null ? "AND user_id = ?" : "";
  const investmentTotal = (
    db
      .query(
        `SELECT COALESCE(SUM(balance), 0) as total FROM investments WHERE status = 'ACTIVE' ${investmentWhere}`
      )
      .get(...(userId != null ? [userId] : [])) as { total: number }
  ).total;
  const currentNetWorth = currentBalance(userId) + investmentTotal;

  const months = monthsUntil(row.target_date);
  const requiredMonthlySavings = (row.target_amount - currentNetWorth) / months;

  // Project all the way out to this goal's own target date, not a fixed
  // window — a flat few-month average can't tell "permanently behind" apart
  // from "one lumpy month" (e.g. a large one-time expense followed by a full
  // recovery), and a goal further out than the window would be judged by a
  // rate that has nothing to do with its own horizon. Deriving the rate from
  // the actual projected balance at the target date keeps this consistent
  // with what the balance chart visually shows.
  const projection = computeProjection({ horizonMonths: months, userId });
  const finalMonth = projection.months[projection.months.length - 1];
  const projectedNetWorthAtTarget =
    investmentTotal + (finalMonth?.balance ?? currentBalance(userId));
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
export function listGoals(userId: number | null = null): Goal[] {
  const where = userId != null ? "WHERE user_id = ?" : "";
  const rows = db
    .query(
      `SELECT id, name, target_amount, target_date FROM goals ${where} ORDER BY target_date ASC`
    )
    .all(...(userId != null ? [userId] : [])) as GoalRow[];
  return rows.map((row) => computeGoal(row, userId));
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
export function createGoal(input: NewGoalInput): number {
  const result = db
    .query("INSERT INTO goals (name, target_amount, target_date, user_id) VALUES (?, ?, ?, ?)")
    .run(input.name, input.targetAmount, input.targetDate, input.userId);
  return Number(result.lastInsertRowid);
}

export const GoalUpdateBody = z.object({
  name: z.string().optional(),
  targetAmount: z.number().optional(),
  targetDate: z.string().optional(),
});
export type GoalUpdateInput = z.infer<typeof GoalUpdateBody>;

export function updateGoal(id: number, input: GoalUpdateInput): void {
  if (!db.query("SELECT id FROM goals WHERE id = ?").get(id)) {
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
    db.query(`UPDATE goals SET ${fields.join(", ")} WHERE id = ?`).run(...(values as []));
  }
}

export function deleteGoal(id: number): void {
  db.query("DELETE FROM goals WHERE id = ?").run(id);
}

export const goalsRoutes = new Elysia({ prefix: "/api/goals" })
  .get("/", ({ query }) => listGoals(parseUserId(query)))
  .post(
    "/",
    ({ body, set, query }) => {
      try {
        createGoal(body);
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
    ({ params, body, set, query }) => {
      try {
        updateGoal(Number(params.id), body);
        return listGoals(parseUserId(query));
      } catch (error) {
        set.status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: GoalUpdateBody }
  )
  .delete("/:id", ({ params, query }) => {
    deleteGoal(Number(params.id));
    return listGoals(parseUserId(query));
  });
