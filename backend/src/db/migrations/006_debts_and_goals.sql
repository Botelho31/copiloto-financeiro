-- Debts: money borrowed (owed_by_me) or lent out (owed_to_me), tracked
-- against whichever repayment transactions get linked to it. Interest isn't
-- amortized precisely (these are informal P2P loans, not bank loans with a
-- schedule) — expected_total_amount is what you actually expect to pay/
-- receive in total; the gap between that and principal is treated as
-- interest, spread proportionally across payments made so far.
--
-- Two ways to establish the principal:
--   1. principal_amount: a flat number you enter directly (a simple loan).
--   2. split_percentage: for a shared expense you fronted (e.g. a house-build
--      cost split 50/50) — principal is computed as split_percentage% of
--      whatever "borrow"/"lend"-role transactions get linked, so linking more
--      shared purchases over time grows the amount owed automatically.
-- Exactly one of the two should be set.
CREATE TABLE debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('owed_by_me', 'owed_to_me')),
  counterparty TEXT,
  principal_amount REAL,
  split_percentage REAL,
  expected_total_amount REAL,
  start_date TEXT NOT NULL,
  target_payoff_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid_off')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- role distinguishes the originating transaction(s) (borrow/lend — the
-- money that established the debt) from repayments (pay_off) — only
-- pay_off transactions count toward "total paid so far", and for a split
-- debt only borrow/lend transactions feed the split_percentage calculation.
CREATE TABLE debt_transactions (
  transaction_id TEXT PRIMARY KEY REFERENCES transactions(id),
  debt_id INTEGER NOT NULL REFERENCES debts(id),
  role TEXT NOT NULL CHECK (role IN ('borrow', 'lend', 'pay_off'))
);
CREATE INDEX idx_debt_transactions_debt ON debt_transactions(debt_id);

CREATE TABLE goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target_amount REAL NOT NULL,
  target_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
