import { Elysia } from "elysia";
import type { Account } from "shared";
import { db } from "../db";

export function listAccounts(): Account[] {
  return db
    .query(
      `SELECT id, name, type, subtype, balance, currency_code, item_id, updated_at
       FROM accounts
       ORDER BY name`
    )
    .all() as Account[];
}

export const accountsRoutes = new Elysia({ prefix: "/api/accounts" }).get("/", () => listAccounts());
