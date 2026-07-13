-- Global (not per-person) app configuration that used to live in .env —
-- cron schedule, notification thresholds, Pushover/SMTP credentials.
-- Editable from /config's "App Settings" tab instead of requiring a
-- restart + redeploy to change. PORT, DB_PATH, and SESSION_SECRET stay in
-- .env since they're needed before the DB is even readable.
CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value TEXT
);
