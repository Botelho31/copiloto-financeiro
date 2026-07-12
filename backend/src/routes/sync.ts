import { Elysia } from "elysia";
import type { SyncLogEntry } from "shared";
import { db } from "../db";
import { triggerSync } from "../jobs/dailySync";
import { parseUserId } from "../lib/scope";

// null userId = Household's most recent sync across every person.
export function getLastSync(userId: number | null = null): SyncLogEntry | null {
  const where = userId != null ? "WHERE user_id = ?" : "";
  return (
    (db
      .query(
        `SELECT id, started_at, finished_at, status, transactions_upserted, error
         FROM sync_log ${where} ORDER BY id DESC LIMIT 1`
      )
      .get(...(userId != null ? [userId] : [])) as SyncLogEntry | null) ?? null
  );
}

export const syncRoutes = new Elysia({ prefix: "/api/sync" })
  .post("/run", async ({ body }) => {
    const input = body as { userId?: number } | null;
    return triggerSync("manual", input?.userId);
  })
  .get("/status", ({ query }) => ({ lastSync: getLastSync(parseUserId(query)) }));
