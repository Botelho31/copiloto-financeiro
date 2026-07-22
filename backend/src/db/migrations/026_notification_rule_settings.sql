-- Each notification rule (large_transaction, projected_shortfall, ...) gets
-- its own enable/disable switch and JSON metadata blob, editable from
-- /config's Notifications tab. `metadata` is rule-specific — e.g.
-- large_transaction's threshold — validated against that rule's own zod
-- schema in code (services/notifications/rules), not by this table.
--
-- user_id NULL is the household default; a specific user_id is that
-- person's own override, which wins over the household default for their
-- own sync (see rules/settings.ts's resolution order). This mirrors
-- getSettings(userId: number | null) for cardSpendGoal in routes/settings.ts.
CREATE TABLE notification_rule_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_key TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}'
);
-- SQLite treats every NULL as distinct under a plain UNIQUE constraint, so
-- "at most one household row per rule" needs its own partial index rather
-- than folding into a single UNIQUE(rule_key, user_id).
CREATE UNIQUE INDEX idx_notification_rule_settings_household
  ON notification_rule_settings (rule_key) WHERE user_id IS NULL;
CREATE UNIQUE INDEX idx_notification_rule_settings_person
  ON notification_rule_settings (rule_key, user_id) WHERE user_id IS NOT NULL;

-- One-time carry-over: large_transaction's threshold used to live in the
-- global app_config table (a leftover from before rules had their own
-- settings). Move it into the rule's household-default row so there's one
-- source of truth going forward, then drop the old key.
INSERT INTO notification_rule_settings (rule_key, user_id, enabled, metadata)
SELECT 'large_transaction', NULL, 1,
  json_object('largeTransactionThreshold', COALESCE(
    (SELECT CAST(value AS REAL) FROM app_config WHERE key = 'large_transaction_threshold'), 500));

DELETE FROM app_config WHERE key = 'large_transaction_threshold';
