import { Elysia } from "elysia";
import type { SyncLogEntry } from "shared";
import { getDb } from "../db";
import { triggerSync } from "../jobs/dailySync";
import { detectRecurringBills } from "../jobs/recurringDetection";
import { detectSelfTransfers } from "../jobs/transferDetection";
import { parseUserId } from "../lib/scope";

// null userId = Household's most recent sync across every person.
export async function getLastSync(userId: number | null = null): Promise<SyncLogEntry | null> {
  const where = userId != null ? "WHERE user_id = ?" : "";
  const result = await getDb().execute({
    sql: `SELECT id, started_at, finished_at, status, transactions_upserted, error
          FROM sync_log ${where} ORDER BY id DESC LIMIT 1`,
    args: userId != null ? [userId] : [],
  });
  return (result.rows[0] as unknown as SyncLogEntry | undefined) ?? null;
}

export const syncRoutes = new Elysia({ prefix: "/api/sync" })
  .post("/run", async ({ body }) => {
    const input = body as { userId?: number } | null;
    return triggerSync("manual", input?.userId);
  })
  .get("/status", async ({ query }) => ({ lastSync: await getLastSync(parseUserId(query)) }))
  // Both normally run automatically after each sync (see jobs/dailySync.ts) —
  // these exist for a manual re-scan, e.g. after backfilling history or
  // tweaking a rule that affects what counts as a match.
  .post("/detect-recurring-bills", async ({ body }) => {
    const { userId } = body as { userId: number };
    return { created: await detectRecurringBills(userId) };
  })
  .post("/detect-self-transfers", async ({ body }) => {
    const { userId } = body as { userId: number };
    return { pairs: await detectSelfTransfers(userId) };
  });
