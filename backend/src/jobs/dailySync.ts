import { getDb } from "../db";
import { runSync, type SyncUser } from "../pluggy/sync";
import { detectRecurringBills } from "./recurringDetection";
import { detectSelfTransfers } from "./transferDetection";

let isRunning = false;

interface UserRow {
  id: number;
  pluggy_client_id: string;
  pluggy_client_secret: string;
  pluggy_item_ids: string | null;
}

// Exported for reuse by the sync-on-unlock check (see db/index.ts's unlock())
// — this app no longer runs a background cron tick (see triggerSync's own
// doc comment below), so staleness is only ever evaluated right after the
// vault unlocks, not on a timer.
export async function usersWithPluggyCredentials(): Promise<SyncUser[]> {
  const result = await getDb().execute(
    `SELECT id, pluggy_client_id, pluggy_client_secret, pluggy_item_ids
     FROM users WHERE pluggy_client_id IS NOT NULL AND pluggy_client_secret IS NOT NULL`
  );
  const rows = result.rows as unknown as UserRow[];
  return rows.map((r) => ({
    id: r.id,
    pluggyClientId: r.pluggy_client_id,
    pluggyClientSecret: r.pluggy_client_secret,
    pluggyItemIds: (r.pluggy_item_ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  }));
}

// Syncs every person with Pluggy credentials on file, one at a time — one
// person's failure (bad credentials, Pluggy outage for their item) doesn't
// block the rest, and each gets their own sync_log row. Pass userId to sync
// just that one person (e.g. a manual "sync me" from /config) instead.
//
// No background scheduler calls this anymore — a locked-by-default app that
// may sit closed for days doesn't suit a cron tick (it either fires while
// locked and fails, or never fires at all if the app isn't running at the
// scheduled hour). Sync is instead triggered on unlock, if enough time has
// passed since the last successful one (see isStale below, wired into
// db/index.ts's unlock()), plus this manual "sync now" path.
export async function triggerSync(reason: string, userId?: number): Promise<{ started: boolean }> {
  if (isRunning) {
    console.log(`[sync] skipped (${reason}) — already running`);
    return { started: false };
  }

  isRunning = true;
  console.log(`[sync] starting (${reason})`);
  try {
    const allUsers = await usersWithPluggyCredentials();
    const users = allUsers.filter((u) => userId == null || u.id === userId);
    for (const user of users) {
      try {
        const { transactionsUpserted } = await runSync(user);
        console.log(
          `[sync] done (${reason}) for user ${user.id}: ${transactionsUpserted} transactions upserted`
        );
        const newBills = await detectRecurringBills(user.id);
        if (newBills > 0) {
          console.log(
            `[sync] detected ${newBills} new recurring bill candidate(s) for user ${user.id}`
          );
        }
        const transferPairs = await detectSelfTransfers(user.id);
        if (transferPairs > 0) {
          console.log(`[sync] detected ${transferPairs} self-transfer pair(s) for user ${user.id}`);
        }
      } catch (error) {
        console.error(`[sync] failed (${reason}) for user ${user.id}:`, error);
      }
    }
    return { started: true };
  } finally {
    isRunning = false;
  }
}

// Exported for reuse by the sync-on-unlock check (see db/index.ts's unlock()).
export async function isStale(userId: number): Promise<boolean> {
  const result = await getDb().execute({
    sql: "SELECT MAX(finished_at) as last FROM sync_log WHERE status = 'success' AND user_id = ?",
    args: [userId],
  });
  const row = result.rows[0] as unknown as { last: string | null };
  if (!row.last) return true;
  const ageMs = Date.now() - new Date(row.last).getTime();
  return ageMs > 24 * 60 * 60 * 1000;
}
