-- Scopes every person-owned table to a user (household member). DEFAULT 1
-- backfills all pre-existing rows onto the seeded "Me" user (021_users.sql)
-- automatically, so no separate data migration is needed.
--
-- No inline REFERENCES here — SQLite's ALTER TABLE ADD COLUMN rejects a
-- REFERENCES column combined with a non-NULL DEFAULT ("Cannot add a
-- REFERENCES column with non-NULL default value"). The FK relationship to
-- users(id) is enforced at the application layer instead (every write goes
-- through routes/services that only ever set a real user id).
ALTER TABLE items ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE accounts ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE investments ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE transactions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE recurring_bills ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE debts ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE goals ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sync_log ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX idx_items_user ON items(user_id);
CREATE INDEX idx_accounts_user ON accounts(user_id);
CREATE INDEX idx_investments_user ON investments(user_id);
CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_recurring_bills_user ON recurring_bills(user_id);
CREATE INDEX idx_debts_user ON debts(user_id);
CREATE INDEX idx_goals_user ON goals(user_id);
CREATE INDEX idx_sync_log_user ON sync_log(user_id);

-- Structured alternative to free-text `counterparty` when the other party in
-- a shared debt (e.g. "Juliana owes 20% of Estudio Foz") is a real household
-- member rather than an outside person. Additive only — split_percentage /
-- debt_links / debt_transactions still drive all the principal/remaining
-- math in routes/debts.ts::computeDebt, unchanged. A shared debt stays one
-- row, so it's counted exactly once in the Household rollup.
ALTER TABLE debts ADD COLUMN shared_with_user_id INTEGER REFERENCES users(id);

-- app_settings needs its primary key rebuilt (SQLite can't ALTER a PK) so
-- each person can have their own settings (e.g. cardSpendGoal) instead of one
-- global value.
ALTER TABLE app_settings RENAME TO app_settings_old;
CREATE TABLE app_settings (
  user_id INTEGER NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
INSERT INTO app_settings (user_id, key, value) SELECT 1, key, value FROM app_settings_old;
DROP TABLE app_settings_old;
