import { db } from "../db";

// Data tables only — categories/admin/_migrations are reference data seeded
// once by the migrations and left alone, so every test still has
// "Uncategorized"/"Transfers"/etc. to work with. Deleted in child-before-
// parent order since shared_with_user_id keeps an inline REFERENCES users(id)
// and PRAGMA foreign_keys is ON.
const DATA_TABLES = [
  "notification_deliveries",
  "notifications",
  "notification_providers",
  "transaction_tags",
  "debt_transactions",
  "debt_links",
  "recurring_bill_matches",
  "sync_log",
  "app_settings",
  "goals",
  "transactions",
  "recurring_bills",
  "debts",
  "investments",
  "accounts",
  "items",
  "category_rules",
  "tags",
  "users",
];

// Called between tests (not between test files — see bunfig.toml's preload)
// so each test starts from a clean, still-migrated database without paying
// for a full re-migration every time. Deliberately does NOT re-seed the
// migration's default "Me" user (id=1) — every test file shares one migrated
// DB for the whole run, and plenty of tests (e.g. "refuses to delete the
// last remaining person") assume a truly empty users table right after
// reset. Migration 021_users.sql's own seeding behavior is instead verified
// once, statically, in db/migrations.test.ts — not by depending on this
// runtime state surviving across every other test file.
export function resetDb(): void {
  for (const table of DATA_TABLES) {
    db.exec(`DELETE FROM ${table};`);
  }
  db.exec(
    `DELETE FROM sqlite_sequence WHERE name IN (${DATA_TABLES.map((t) => `'${t}'`).join(",")});`
  );
}

export interface TestUserOverrides {
  name?: string;
  color?: string;
  pluggyClientId?: string | null;
  pluggyClientSecret?: string | null;
  pluggyItemIds?: string | null;
}

let userCounter = 0;

// Bypasses the routes/users.ts validation path (name-uniqueness, etc.) since
// tests want a quick, always-valid fixture — the validation itself is what
// users.test.ts exercises directly.
export function insertTestUser(overrides: TestUserOverrides = {}): number {
  userCounter += 1;
  const name = overrides.name ?? `Test User ${userCounter}`;
  const result = db
    .query(
      `INSERT INTO users (name, color, pluggy_client_id, pluggy_client_secret, pluggy_item_ids)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      name,
      overrides.color ?? "#5f7fbf",
      overrides.pluggyClientId ?? null,
      overrides.pluggyClientSecret ?? null,
      overrides.pluggyItemIds ?? null
    );
  return Number(result.lastInsertRowid);
}

export function categoryIdByName(name: string): number {
  const row = db.query("SELECT id FROM categories WHERE name = ?").get(name) as {
    id: number;
  } | null;
  if (!row)
    throw new Error(`Fixture setup: category "${name}" not found — did migrations seed it?`);
  return row.id;
}

let transactionCounter = 0;

export interface TestTransactionOverrides {
  id?: string;
  accountId: string;
  userId: number;
  date: string;
  description?: string;
  amount: number;
  type?: "CREDIT" | "DEBIT";
  status?: "PENDING" | "POSTED";
  categoryId?: number | null;
}

export function insertTestTransaction(overrides: TestTransactionOverrides): string {
  transactionCounter += 1;
  const id = overrides.id ?? `test-tx-${transactionCounter}`;
  db.query(
    `INSERT INTO transactions (id, account_id, user_id, date, description, amount, type, status, currency_code, category_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'BRL', ?)`
  ).run(
    id,
    overrides.accountId,
    overrides.userId,
    overrides.date,
    overrides.description ?? "Test transaction",
    overrides.amount,
    overrides.type ?? (overrides.amount < 0 ? "DEBIT" : "CREDIT"),
    overrides.status ?? "POSTED",
    overrides.categoryId ?? categoryIdByName("Uncategorized")
  );
  return id;
}

export interface TestAccountOverrides {
  id: string;
  userId: number;
  itemId?: string;
  name?: string;
  type?: string;
  subtype?: string;
  balance?: number;
}

export function insertTestAccount(overrides: TestAccountOverrides): string {
  const itemId = overrides.itemId ?? `test-item-${overrides.id}`;
  db.query("INSERT OR IGNORE INTO items (id, user_id, status) VALUES (?, ?, 'active')").run(
    itemId,
    overrides.userId
  );
  db.query(
    `INSERT INTO accounts (id, item_id, user_id, name, type, subtype, balance, currency_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'BRL')`
  ).run(
    overrides.id,
    itemId,
    overrides.userId,
    overrides.name ?? overrides.id,
    overrides.type ?? "BANK",
    overrides.subtype ?? "checking",
    overrides.balance ?? 0
  );
  return overrides.id;
}
