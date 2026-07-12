import { Elysia } from "elysia";
import type { Account } from "shared";
import { db } from "../db";
import { parseUserId } from "../lib/scope";

// null userId = Household (every person's accounts combined).
export function listAccounts(userId: number | null = null): Account[] {
  const where = userId != null ? "WHERE user_id = ?" : "";
  return db
    .query(
      `SELECT id, name, type, subtype, balance, currency_code, item_id, user_id, updated_at
       FROM accounts
       ${where}
       ORDER BY name`
    )
    .all(...(userId != null ? [userId] : [])) as Account[];
}

export const accountsRoutes = new Elysia({ prefix: "/api/accounts" }).get("/", ({ query }) =>
  listAccounts(parseUserId(query))
);
