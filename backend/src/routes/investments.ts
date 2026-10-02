import { Elysia } from "elysia";
import type { Investment } from "shared";
import { getDb } from "../db";
import { parseUserId } from "../lib/scope";

// null userId = Household (every person's investments combined).
export async function listInvestments(userId: number | null = null): Promise<Investment[]> {
  const where = userId != null ? "WHERE user_id = ?" : "";
  const result = await getDb().execute({
    sql: `SELECT id, item_id, user_id, name, type, subtype, balance, currency_code, status
          FROM investments
          ${where}
          ORDER BY name`,
    args: userId != null ? [userId] : [],
  });
  return result.rows as unknown as Investment[];
}

export const investmentsRoutes = new Elysia({ prefix: "/api/investments" }).get("/", ({ query }) =>
  listInvestments(parseUserId(query))
);
