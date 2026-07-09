import { Elysia } from "elysia";
import type { Investment } from "shared";
import { db } from "../db";

export function listInvestments(): Investment[] {
  return db
    .query(
      `SELECT id, item_id, name, type, subtype, balance, currency_code, status
       FROM investments
       ORDER BY name`
    )
    .all() as Investment[];
}

export const investmentsRoutes = new Elysia({ prefix: "/api/investments" }).get("/", () =>
  listInvestments()
);
