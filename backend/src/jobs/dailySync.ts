import { Cron } from "croner";
import { config } from "../config";
import { db } from "../db";
import { runSync } from "../pluggy/sync";
import { detectRecurringBills } from "./recurringDetection";
import { detectSelfTransfers } from "./transferDetection";

let isRunning = false;

export async function triggerSync(reason: string): Promise<{ started: boolean }> {
  if (isRunning) {
    console.log(`[sync] skipped (${reason}) — already running`);
    return { started: false };
  }

  isRunning = true;
  console.log(`[sync] starting (${reason})`);
  try {
    const { transactionsUpserted } = await runSync();
    console.log(`[sync] done (${reason}): ${transactionsUpserted} transactions upserted`);
    const newBills = detectRecurringBills();
    if (newBills > 0) console.log(`[sync] detected ${newBills} new recurring bill candidate(s)`);
    const transferPairs = detectSelfTransfers();
    if (transferPairs > 0) console.log(`[sync] detected ${transferPairs} self-transfer pair(s)`);
    return { started: true };
  } catch (error) {
    console.error(`[sync] failed (${reason}):`, error);
    return { started: true };
  } finally {
    isRunning = false;
  }
}

function isStale(): boolean {
  const row = db
    .query("SELECT MAX(finished_at) as last FROM sync_log WHERE status = 'success'")
    .get() as { last: string | null };
  if (!row.last) return true;
  const ageMs = Date.now() - new Date(row.last).getTime();
  return ageMs > 24 * 60 * 60 * 1000;
}

export function startDailySync(): void {
  new Cron(config.cronSchedule, () => {
    void triggerSync("cron");
  });

  if (isStale()) {
    void triggerSync("startup catch-up");
  }
}
