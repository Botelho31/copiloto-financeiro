import { Elysia } from "elysia";
import type { SyncLogEntry } from "shared";
import { db } from "../db";
import { triggerSync } from "../jobs/dailySync";

export function getLastSync(): SyncLogEntry | null {
  return (
    (db
      .query(
        `SELECT id, started_at, finished_at, status, transactions_upserted, error
         FROM sync_log ORDER BY id DESC LIMIT 1`
      )
      .get() as SyncLogEntry | null) ?? null
  );
}

export const syncRoutes = new Elysia({ prefix: "/api/sync" })
  .post("/run", async () => triggerSync("manual"))
  .get("/status", () => ({ lastSync: getLastSync() }));
