CREATE TABLE admin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  connector_name TEXT,
  status TEXT,
  last_synced_at TEXT
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  subtype TEXT,
  balance REAL NOT NULL DEFAULT 0,
  currency_code TEXT NOT NULL DEFAULT 'BRL',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  parent_id INTEGER REFERENCES categories(id)
);

CREATE TABLE category_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_text TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id)
);
CREATE INDEX idx_category_rules_match_text ON category_rules(match_text);

CREATE TABLE recurring_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  expected_amount REAL NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('weekly', 'monthly', 'yearly')),
  next_due_date TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual', 'detected')),
  confirmed INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  description_raw TEXT,
  amount REAL NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('DEBIT', 'CREDIT')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'POSTED')),
  currency_code TEXT NOT NULL DEFAULT 'BRL',
  category_id INTEGER REFERENCES categories(id),
  recurring_bill_id INTEGER REFERENCES recurring_bills(id),
  raw_json TEXT
);
CREATE INDEX idx_transactions_account_date ON transactions(account_id, date);
CREATE INDEX idx_transactions_category ON transactions(category_id);
CREATE INDEX idx_transactions_description ON transactions(description);

CREATE TABLE recurring_bill_matches (
  recurring_bill_id INTEGER NOT NULL REFERENCES recurring_bills(id),
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  PRIMARY KEY (recurring_bill_id, transaction_id)
);

CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
  transactions_upserted INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
