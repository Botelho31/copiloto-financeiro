-- Named, individually-revocable credentials for non-browser clients (MCP
-- today, possibly others later) — see vault/crypto.ts for how the raw key is
-- generated/hashed. The raw key itself is never stored, only its hash;
-- losing it just means generating a new one, nothing to recover. Stable
-- across lock/unlock cycles by design — isUnlocked() is what actually gates
-- real access, not the key's own existence (see routes/vault.ts).
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
