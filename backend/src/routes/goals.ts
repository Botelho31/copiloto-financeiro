import { Elysia } from "elysia";
import type { Goal } from "shared";
import { db } from "../db";
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

function computeGoal(row: GoalRow): Goal {
  // Includes investment holdings alongside cash — a goal is about total net
  // worth reaching a number, not just what's liquid in the bank.
  const investmentTotal = (
    db
      .query("SELECT COALESCE(SUM(balance), 0) as total FROM investments WHERE status = 'ACTIVE'")
      .get() as { total: number }
  ).total;
  const currentNetWorth = currentBalance() + investmentTotal;

  const months = monthsUntil(row.target_date);
  const requiredMonthlySavings = (row.target_amount - currentNetWorth) / months;

  // Project all the way out to this goal's own target date, not a fixed
  // window — a flat few-month average can't tell "permanently behind" apart
  // from "one lumpy month" (e.g. a large one-time expense followed by a full
  // recovery), and a goal further out than the window would be judged by a
  // rate that has nothing to do with its own horizon. Deriving the rate from
  // the actual projected balance at the target date keeps this consistent
  // with what the balance chart visually shows.
  const projection = computeProjection({ horizonMonths: months });
  const finalMonth = projection.months[projection.months.length - 1];
  const projectedNetWorthAtTarget = investmentTotal + (finalMonth?.balance ?? currentBalance());
  const projectedMonthlySavings = (projectedNetWorthAtTarget - currentNetWorth) / months;

  return {
    ...row,
    required_monthly_savings: requiredMonthlySavings,
    projected_monthly_savings: projectedMonthlySavings,
    on_track: projectedNetWorthAtTarget >= row.target_amount,
  };
}

export function listGoals(): Goal[] {
  const rows = db
    .query("SELECT id, name, target_amount, target_date FROM goals ORDER BY target_date ASC")
    .all() as GoalRow[];
  return rows.map(computeGoal);
}

export const goalsRoutes = new Elysia({ prefix: "/api/goals" })
  .get("/", () => listGoals())
  .post("/", ({ body, set }) => {
    const input = body as { name?: string; targetAmount?: number; targetDate?: string };
    if (!input.name || !input.targetAmount || !input.targetDate) {
      set.status = 400;
      return { error: "name, targetAmount and targetDate are required" };
    }
    db.query("INSERT INTO goals (name, target_amount, target_date) VALUES (?, ?, ?)").run(
      input.name,
      input.targetAmount,
      input.targetDate
    );
    return listGoals();
  })
  .patch("/:id", ({ params, body, set }) => {
    const id = Number(params.id);
    const existing = db.query("SELECT id FROM goals WHERE id = ?").get(id);
    if (!existing) {
      set.status = 404;
      return { error: "not found" };
    }

    const input = body as Partial<{ name: string; targetAmount: number; targetDate: string }>;
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
    return listGoals();
  })
  .delete("/:id", ({ params }) => {
    db.query("DELETE FROM goals WHERE id = ?").run(Number(params.id));
    return listGoals();
  });
