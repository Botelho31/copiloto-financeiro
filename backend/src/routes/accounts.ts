import { Elysia } from "elysia";
import type { Account } from "shared";
import { getDb } from "../db";
import { parseUserId } from "../lib/scope";

// null userId = Household (every person's accounts combined).
export async function listAccounts(userId: number | null = null): Promise<Account[]> {
  const where = userId != null ? "WHERE user_id = ?" : "";
  const result = await getDb().execute({
    sql: `SELECT id, name, type, subtype, balance, currency_code, item_id, user_id, updated_at
          FROM accounts
          ${where}
          ORDER BY name`,
    args: userId != null ? [userId] : [],
  });
  return result.rows as unknown as Account[];
}

export const accountsRoutes = new Elysia({ prefix: "/api/accounts" }).get("/", ({ query }) =>
  listAccounts(parseUserId(query))
);
