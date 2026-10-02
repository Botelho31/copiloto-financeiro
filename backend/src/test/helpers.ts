import { getDb } from "../db";

// Data tables only — categories/admin/_migrations are reference data seeded
// once by the migrations and left alone, so every test still has
// "Uncategorized"/"Transfers"/etc. to work with. Deleted in child-before-
// parent order since shared_with_user_id keeps an inline REFERENCES users(id)
// and PRAGMA foreign_keys is ON.
const DATA_TABLES = [
  "app_config",
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
export async function resetDb(): Promise<void> {
  const db = getDb();
  for (const table of DATA_TABLES) {
    await db.execute(`DELETE FROM ${table};`);
  }
  await db.execute(
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
export async function insertTestUser(overrides: TestUserOverrides = {}): Promise<number> {
  userCounter += 1;
  const name = overrides.name ?? `Test User ${userCounter}`;
  const result = await getDb().execute({
    sql: `INSERT INTO users (name, color, pluggy_client_id, pluggy_client_secret, pluggy_item_ids)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      name,
      overrides.color ?? "#5f7fbf",
      overrides.pluggyClientId ?? null,
      overrides.pluggyClientSecret ?? null,
      overrides.pluggyItemIds ?? null,
    ],
  });
  return Number(result.lastInsertRowid);
}

export async function categoryIdByName(name: string): Promise<number> {
  const result = await getDb().execute({
    sql: "SELECT id FROM categories WHERE name = ?",
    args: [name],
  });
  const row = result.rows[0] as unknown as { id: number } | undefined;
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

export async function insertTestTransaction(overrides: TestTransactionOverrides): Promise<string> {
  transactionCounter += 1;
  const id = overrides.id ?? `test-tx-${transactionCounter}`;
  await getDb().execute({
    sql: `INSERT INTO transactions (id, account_id, user_id, date, description, amount, type, status, currency_code, category_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'BRL', ?)`,
    args: [
      id,
      overrides.accountId,
      overrides.userId,
      overrides.date,
      overrides.description ?? "Test transaction",
      overrides.amount,
      overrides.type ?? (overrides.amount < 0 ? "DEBIT" : "CREDIT"),
      overrides.status ?? "POSTED",
      overrides.categoryId ?? (await categoryIdByName("Uncategorized")),
    ],
  });
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

export async function insertTestAccount(overrides: TestAccountOverrides): Promise<string> {
  const itemId = overrides.itemId ?? `test-item-${overrides.id}`;
  const db = getDb();
  await db.execute({
    sql: "INSERT OR IGNORE INTO items (id, user_id, status) VALUES (?, ?, 'active')",
    args: [itemId, overrides.userId],
  });
  await db.execute({
    sql: `INSERT INTO accounts (id, item_id, user_id, name, type, subtype, balance, currency_code)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'BRL')`,
    args: [
      overrides.id,
      itemId,
      overrides.userId,
      overrides.name ?? overrides.id,
      overrides.type ?? "BANK",
      overrides.subtype ?? "checking",
      overrides.balance ?? 0,
    ],
  });
  return overrides.id;
}

export interface TestInvestmentOverrides {
  id: string;
  userId: number;
  itemId?: string;
  name?: string;
  type?: string;
  balance?: number;
  status?: string;
}

export async function insertTestInvestment(overrides: TestInvestmentOverrides): Promise<string> {
  const itemId = overrides.itemId ?? `test-item-${overrides.id}`;
  const db = getDb();
  await db.execute({
    sql: "INSERT OR IGNORE INTO items (id, user_id, status) VALUES (?, ?, 'active')",
    args: [itemId, overrides.userId],
  });
  await db.execute({
    sql: `INSERT INTO investments (id, item_id, user_id, name, type, balance, currency_code, status)
          VALUES (?, ?, ?, ?, ?, ?, 'BRL', ?)`,
    args: [
      overrides.id,
      itemId,
      overrides.userId,
      overrides.name ?? overrides.id,
      overrides.type ?? "FIXED_INCOME",
      overrides.balance ?? 0,
      overrides.status ?? "ACTIVE",
    ],
  });
  return overrides.id;
}
