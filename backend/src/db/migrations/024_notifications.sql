-- Extensible notification system: a rule evaluates something after each
-- sync (a large transaction, a projected shortfall, ...) and, if it fires,
-- writes one row here; delivery then fans out to whichever providers
-- (Pushover, email, ...) this person has enabled. The UNIQUE constraint on
-- (user_id, rule_key, dedupe_key) is the whole dedup mechanism — a rule
-- re-firing for the same underlying event (the same transaction, the same
-- calendar month's shortfall) is an INSERT ... ON CONFLICT DO NOTHING, so
-- it's silently a no-op instead of spamming a duplicate notification.
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  rule_key TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info', -- 'info' | 'warning' | 'critical'
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  data TEXT, -- optional JSON blob with structured context (e.g. {"transactionId": "..."})
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT,
  UNIQUE (user_id, rule_key, dedupe_key)
);
CREATE INDEX idx_notifications_user_created ON notifications (user_id, created_at DESC);

-- Per-person delivery channels. `provider` is a free-form string matched
-- against a handler registry in code (services/notifications/providers) —
-- adding a new provider is a new handler + a new row shape here, not a
-- schema change. `config` is provider-specific JSON (e.g. Pushover's user
-- key, or an email address) since each provider needs different fields.
CREATE TABLE notification_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  config TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, provider)
);

-- One row per (notification, provider) delivery attempt — lets "did this
-- actually reach me" be answered per channel, not just "was it created".
CREATE TABLE notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER NOT NULL REFERENCES notifications(id),
  provider TEXT NOT NULL,
  status TEXT NOT NULL, -- 'sent' | 'failed'
  error TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notification_deliveries_notification ON notification_deliveries (notification_id);
