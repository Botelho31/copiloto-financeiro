CREATE TABLE investments (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  subtype TEXT,
  balance REAL NOT NULL DEFAULT 0,
  currency_code TEXT NOT NULL DEFAULT 'BRL',
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
