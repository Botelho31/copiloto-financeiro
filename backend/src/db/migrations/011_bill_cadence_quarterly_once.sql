-- Widen the cadence CHECK constraint to add 'quarterly' (e.g. stock vesting)
-- and 'once' (a single future one-off, like a December vacation-cashout
-- bonus) alongside the existing weekly/monthly/yearly. SQLite can't ALTER a
-- CHECK constraint in place, so recreate the table.
--
-- Note: the migration runner wraps each file's exec in db.transaction(...),
-- and SQLite treats "PRAGMA foreign_keys = OFF" as a no-op inside a pending
-- transaction — so it can't be used here to relax the FK check while
-- recurring_bills and its dependent recurring_bill_matches briefly coexist
-- in old and new form. Instead: fully retire recurring_bill_matches (copy
-- its rows out to a plain holding table with no FK) before recurring_bills
-- is touched at all, so nothing is ever referencing it when it's dropped.
CREATE TABLE recurring_bill_matches_holding (
  recurring_bill_id INTEGER NOT NULL,
  transaction_id TEXT NOT NULL
);
INSERT INTO recurring_bill_matches_holding SELECT * FROM recurring_bill_matches;
DROP TABLE recurring_bill_matches;

CREATE TABLE recurring_bills_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  expected_amount REAL NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('weekly', 'monthly', 'quarterly', 'yearly', 'once')),
  next_due_date TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual', 'detected')),
  confirmed INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO recurring_bills_new SELECT * FROM recurring_bills;
DROP TABLE recurring_bills;
ALTER TABLE recurring_bills_new RENAME TO recurring_bills;

CREATE TABLE recurring_bill_matches (
  recurring_bill_id INTEGER NOT NULL REFERENCES recurring_bills(id),
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  PRIMARY KEY (recurring_bill_id, transaction_id)
);
INSERT INTO recurring_bill_matches SELECT * FROM recurring_bill_matches_holding;
DROP TABLE recurring_bill_matches_holding;
