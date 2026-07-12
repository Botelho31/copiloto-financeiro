import { Cron } from "croner";
import { config } from "../config";
import { db } from "../db";
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

function usersWithPluggyCredentials(): SyncUser[] {
  const rows = db
    .query(
      `SELECT id, pluggy_client_id, pluggy_client_secret, pluggy_item_ids
       FROM users WHERE pluggy_client_id IS NOT NULL AND pluggy_client_secret IS NOT NULL`
    )
    .all() as UserRow[];
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
export async function triggerSync(reason: string, userId?: number): Promise<{ started: boolean }> {
  if (isRunning) {
    console.log(`[sync] skipped (${reason}) — already running`);
    return { started: false };
  }

  isRunning = true;
  console.log(`[sync] starting (${reason})`);
  try {
    const users = usersWithPluggyCredentials().filter((u) => userId == null || u.id === userId);
    for (const user of users) {
      try {
        const { transactionsUpserted } = await runSync(user);
        console.log(
          `[sync] done (${reason}) for user ${user.id}: ${transactionsUpserted} transactions upserted`
        );
        const newBills = detectRecurringBills(user.id);
        if (newBills > 0) {
          console.log(
            `[sync] detected ${newBills} new recurring bill candidate(s) for user ${user.id}`
          );
        }
        const transferPairs = detectSelfTransfers(user.id);
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

function isStale(userId: number): boolean {
  const row = db
    .query("SELECT MAX(finished_at) as last FROM sync_log WHERE status = 'success' AND user_id = ?")
    .get(userId) as { last: string | null };
  if (!row.last) return true;
  const ageMs = Date.now() - new Date(row.last).getTime();
  return ageMs > 24 * 60 * 60 * 1000;
}

export function startDailySync(): void {
  new Cron(config.cronSchedule, () => {
    void triggerSync("cron");
  });

  const anyStale = usersWithPluggyCredentials().some((u) => isStale(u.id));
  if (anyStale) {
    void triggerSync("startup catch-up");
  }
}
