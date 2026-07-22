import { db } from "../../../db";
import { ALL_RULES } from "./registry";
import type { NotificationRule } from "./types";

export interface RuleSettings {
  enabled: boolean;
  metadata: Record<string, unknown>;
}

export interface RuleSettingsRow extends RuleSettings {
  key: string;
  // null = the household default; a specific id = that person's own override.
  userId: number | null;
}

interface DbRow {
  id: number;
  rule_key: string;
  user_id: number | null;
  enabled: number;
  metadata: string;
}

// metadataSchema is typed ZodTypeAny (each rule's own concrete schema type
// is erased once it's stored generically on NotificationRule), so .parse()'s
// return type is unknown here — always actually an object, since every
// rule's schema is z.object({...}).strict().
function parseMetadata(rule: NotificationRule, raw: unknown): Record<string, unknown> {
  return rule.metadataSchema.parse(raw) as Record<string, unknown>;
}

function findRule(ruleKey: string): NotificationRule {
  const rule = ALL_RULES.find((r) => r.key === ruleKey);
  if (!rule) throw new Error(`Unknown notification rule: ${ruleKey}`);
  return rule;
}

// The raw stored row for one exact scope — a specific person, or the
// household default when userId is null — no fallback. `user_id IS ?`
// (not `=`) so a null-bound parameter correctly matches a NULL column,
// which plain `=` never does in SQL.
function getRawRow(ruleKey: string, userId: number | null): DbRow | null {
  return db
    .query(
      "SELECT id, rule_key, user_id, enabled, metadata FROM notification_rule_settings WHERE rule_key = ? AND user_id IS ?"
    )
    .get(ruleKey, userId) as DbRow | null;
}

function rowToSettings(rule: NotificationRule, row: DbRow): RuleSettingsRow {
  return {
    key: row.rule_key,
    userId: row.user_id,
    enabled: row.enabled === 1,
    metadata: parseMetadata(rule, JSON.parse(row.metadata)),
  };
}

export function getRuleRow(ruleKey: string, userId: number | null): RuleSettingsRow | null {
  const rule = findRule(ruleKey);
  const row = getRawRow(ruleKey, userId);
  return row ? rowToSettings(rule, row) : null;
}

// Effective settings for an actual sync (dailySync.ts always has a concrete
// person): that person's own row wins, else the household default, else
// the rule's schema defaults. Deliberately returns the plain RuleSettings
// shape (not RuleSettingsRow) — a resolved value has no single row it came
// from, so it wouldn't make sense to attach one row's key/userId to it.
export function getResolvedRuleSettings(rule: NotificationRule, userId: number): RuleSettings {
  const personRow = getRawRow(rule.key, userId);
  if (personRow)
    return {
      enabled: personRow.enabled === 1,
      metadata: parseMetadata(rule, JSON.parse(personRow.metadata)),
    };
  const householdRow = getRawRow(rule.key, null);
  if (householdRow)
    return {
      enabled: householdRow.enabled === 1,
      metadata: parseMetadata(rule, JSON.parse(householdRow.metadata)),
    };
  return { enabled: true, metadata: parseMetadata(rule, {}) };
}

// One query per rule, resolved for one specific person — used by the
// dispatch loop once per sync.
export function getAllResolvedRuleSettings(userId: number): Map<string, RuleSettings> {
  const result = new Map<string, RuleSettings>();
  for (const rule of ALL_RULES) {
    result.set(rule.key, getResolvedRuleSettings(rule, userId));
  }
  return result;
}

// Every row that actually exists (household defaults + any per-person
// overrides) — the settings UI renders from this directly rather than
// resolving per-person server-side, since it needs to show both "the
// household default" and "who has their own override" at once.
export function listRuleRows(): RuleSettingsRow[] {
  const rows = db
    .query("SELECT id, rule_key, user_id, enabled, metadata FROM notification_rule_settings")
    .all() as DbRow[];
  return rows.map((row) => rowToSettings(findRule(row.rule_key), row));
}

// Creates/updates the row for one exact scope. An omitted field leaves it
// unchanged. A brand-new per-person override seeds from that person's
// current *resolved* value (household default, or schema defaults if
// neither exists yet) before applying partial on top — so customizing one
// field doesn't silently reset the rest. metadata is validated against the
// rule's own schema before being persisted (throws on a bad value; the
// route turns that into a 400).
export function upsertRuleSettings(
  ruleKey: string,
  userId: number | null,
  partial: { enabled?: boolean; metadata?: Record<string, unknown> }
): RuleSettingsRow {
  const rule = findRule(ruleKey);
  const existing = getRawRow(ruleKey, userId);
  const current: RuleSettings = existing
    ? rowToSettings(rule, existing)
    : userId != null
      ? getResolvedRuleSettings(rule, userId)
      : { enabled: true, metadata: parseMetadata(rule, {}) };

  const enabled = partial.enabled ?? current.enabled;
  const metadata = parseMetadata(
    rule,
    partial.metadata ? { ...current.metadata, ...partial.metadata } : current.metadata
  );

  if (existing) {
    db.query("UPDATE notification_rule_settings SET enabled = ?, metadata = ? WHERE id = ?").run(
      enabled ? 1 : 0,
      JSON.stringify(metadata),
      existing.id
    );
  } else {
    db.query(
      "INSERT INTO notification_rule_settings (rule_key, user_id, enabled, metadata) VALUES (?, ?, ?, ?)"
    ).run(ruleKey, userId, enabled ? 1 : 0, JSON.stringify(metadata));
  }

  return { key: ruleKey, userId, enabled, metadata };
}

// Removes the row for one exact scope — a person's override falls back to
// the household default (or schema defaults) on their next sync; deleting
// the household row itself falls back straight to schema defaults for
// anyone without their own override.
export function deleteRuleRow(ruleKey: string, userId: number | null): void {
  findRule(ruleKey); // throws on an unknown key, same guard as upsertRuleSettings
  db.query("DELETE FROM notification_rule_settings WHERE rule_key = ? AND user_id IS ?").run(
    ruleKey,
    userId
  );
}
