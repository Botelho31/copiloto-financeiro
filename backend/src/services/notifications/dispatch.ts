import { db } from "../../db";
import { PROVIDER_HANDLERS } from "./providers";
import { ALL_RULES, type NotificationDraft, type SyncContext } from "./rules";

interface ProviderRow {
  provider: string;
  config: string;
}

async function deliver(
  notificationId: number,
  userId: number,
  notification: { title: string; body: string }
): Promise<void> {
  const providers = db
    .query("SELECT provider, config FROM notification_providers WHERE user_id = ? AND enabled = 1")
    .all(userId) as ProviderRow[];

  for (const row of providers) {
    const handler = PROVIDER_HANDLERS[row.provider];
    if (!handler) continue; // an unknown/removed provider key on an old row — skip, don't crash the sync
    const result = await handler.send(JSON.parse(row.config), notification);
    db.query(
      "INSERT INTO notification_deliveries (notification_id, provider, status, error) VALUES (?, ?, ?, ?)"
    ).run(notificationId, row.provider, result.ok ? "sent" : "failed", result.error ?? null);
  }
}

function insertIfNew(userId: number, draft: NotificationDraft): number | null {
  const result = db
    .query(
      `INSERT INTO notifications (user_id, rule_key, severity, title, body, dedupe_key, data)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, rule_key, dedupe_key) DO NOTHING`
    )
    .run(
      userId,
      draft.ruleKey,
      draft.severity,
      draft.title,
      draft.body,
      draft.dedupeKey,
      draft.data ? JSON.stringify(draft.data) : null
    );
  return result.changes > 0 ? Number(result.lastInsertRowid) : null;
}

// Runs every rule against this sync's context; each rule that fires gets
// deduped against its own prior firings (see rules.ts's dedupeKey doc) and,
// only if genuinely new, delivered through every provider this person has
// enabled. Returns how many new notifications were actually created, for
// the sync job's own logging.
export async function evaluateAndDispatch(ctx: SyncContext): Promise<number> {
  let created = 0;
  for (const rule of ALL_RULES) {
    const drafts = rule.evaluate(ctx);
    for (const draft of drafts) {
      const notificationId = insertIfNew(ctx.userId, draft);
      if (notificationId === null) continue; // already existed — not a new event, don't re-deliver
      created += 1;
      await deliver(notificationId, ctx.userId, { title: draft.title, body: draft.body });
    }
  }
  return created;
}
