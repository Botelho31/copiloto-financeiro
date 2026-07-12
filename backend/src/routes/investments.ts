import { Elysia } from "elysia";
import type { Investment } from "shared";
import { db } from "../db";
import { parseUserId } from "../lib/scope";

// null userId = Household (every person's investments combined).
export function listInvestments(userId: number | null = null): Investment[] {
  const where = userId != null ? "WHERE user_id = ?" : "";
  return db
    .query(
      `SELECT id, item_id, user_id, name, type, subtype, balance, currency_code, status
       FROM investments
       ${where}
       ORDER BY name`
    )
    .all(...(userId != null ? [userId] : [])) as Investment[];
}

export const investmentsRoutes = new Elysia({ prefix: "/api/investments" }).get("/", ({ query }) =>
  listInvestments(parseUserId(query))
);
