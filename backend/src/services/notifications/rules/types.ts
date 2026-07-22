import type { ZodTypeAny } from "zod";
import type { NotificationSeverity } from "shared";

export interface NotificationDraft {
  ruleKey: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  // Scoped per rule (not globally unique) — the DB constraint is on
  // (user_id, rule_key, dedupe_key) together, so two different rules can
  // reuse the same dedupe_key without colliding.
  dedupeKey: string;
  data?: Record<string, unknown>;
  // A new draft still gets its own row (history/audit keeps every month a
  // condition held), but dispatch skips the provider fan-out — for a
  // condition that stays true across several evaluations (e.g. an
  // unresolved projected shortfall), only the month it first appeared
  // should actually page anyone.
  silent?: boolean;
}

// Everything a rule might need to decide whether to fire, gathered once per
// user per sync rather than each rule re-querying independently.
export interface SyncContext {
  userId: number;
  newTransactionIds: string[];
}

// `metadataSchema` is the single source of truth for a rule's configurable
// shape: it validates a PATCH .../rules/:key body, and schema.parse({})
// (via each field's own .default(...)) produces the rule's defaults — no
// separate defaults object to keep in sync (see rules/settings.ts).
export interface NotificationRule<M extends Record<string, unknown> = Record<string, unknown>> {
  key: string;
  metadataSchema: ZodTypeAny;
  evaluate(ctx: SyncContext, metadata: M): NotificationDraft[];
}
