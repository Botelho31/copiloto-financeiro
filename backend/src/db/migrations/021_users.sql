-- Household members. Not login accounts (auth stays single-admin, see
-- backend/src/auth) — each row is a person whose own accounts, transactions,
-- bills, debts, and goals get scoped to them via user_id in the next
-- migration. Pluggy credentials move here (one bank-connection identity per
-- person) instead of the old single global .env triple.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6b7280',
  pluggy_client_id TEXT,
  pluggy_client_secret TEXT,
  pluggy_item_ids TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seeded so every existing (pre-multi-user) row has somewhere to backfill
-- onto via the DEFAULT 1 columns added in 022_user_scoping.sql.
INSERT INTO users (id, name) VALUES (1, 'Me');
