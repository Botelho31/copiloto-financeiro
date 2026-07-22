import { describe, expect, test } from "bun:test";
import { db } from "./index";

// The preload script (backend/src/test/preload.ts) already pointed DB_PATH
// at a fresh temp file before this module (or any other) was imported, so
// importing "./index" above is what actually ran every migration for real —
// this file just asserts the result looks right.
describe("migrations", () => {
  test("apply cleanly and are all recorded", () => {
    const migrationsDir = new URL("./migrations", import.meta.url);
    const fileCount = Array.from(
      new Bun.Glob("*.sql").scanSync({ cwd: migrationsDir.pathname })
    ).length;
    const applied = db.query("SELECT COUNT(*) as n FROM _migrations").get() as { n: number };
    expect(applied.n).toBe(fileCount);
  });

  test("seeds the default categories", () => {
    const names = (
      db.query("SELECT name FROM categories ORDER BY name").all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toContain("Uncategorized");
    expect(names).toContain("Transfers");
    expect(names).toContain("Savings & Investments");
    expect(names).toContain("Debt & Credit Card");
  });

  test("flags category behaviors instead of relying on the name (R5)", () => {
    const savings = db
      .query("SELECT is_investment_transfer, is_card_bill_payment FROM categories WHERE name = ?")
      .get("Savings & Investments") as {
      is_investment_transfer: number;
      is_card_bill_payment: number;
    };
    expect(savings.is_investment_transfer).toBe(1);
    expect(savings.is_card_bill_payment).toBe(0);

    const card = db
      .query("SELECT is_investment_transfer, is_card_bill_payment FROM categories WHERE name = ?")
      .get("Debt & Credit Card") as {
      is_investment_transfer: number;
      is_card_bill_payment: number;
    };
    expect(card.is_card_bill_payment).toBe(1);
    expect(card.is_investment_transfer).toBe(0);
  });

  // Checks the migration file's own SQL rather than live `users` table state —
  // other test files' resetDb() (see test/helpers.ts) intentionally clears
  // `users` back to empty, since plenty of tests need a truly empty table to
  // test guards like "refuses to delete the last remaining person" — so this
  // behavior has to be verified statically, not by asserting on shared
  // runtime state that's expected to change across the run.
  test("seeds a default 'Me' user that pre-existing rows backfill onto", async () => {
    const sql = await Bun.file(new URL("./migrations/021_users.sql", import.meta.url)).text();
    expect(sql).toContain("INSERT INTO users (id, name) VALUES (1, 'Me')");
  });

  test("app_settings is keyed by (user_id, key), not just key", () => {
    const schema = db
      .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'")
      .get() as { sql: string };
    expect(schema.sql).toContain("user_id");
    expect(schema.sql).toContain("PRIMARY KEY (user_id, key)");
  });

  // Checked against the migration's own SQL rather than live DB state, same
  // reasoning as the "Me" user test above — notification_rule_settings is in
  // DATA_TABLES now, so another test file's resetDb() elsewhere in this same
  // shared-DB run would wipe out the seeded row before this test ever saw it.
  test("moves large_transaction_threshold out of app_config into notification_rule_settings", async () => {
    const sql = await Bun.file(
      new URL("./migrations/026_notification_rule_settings.sql", import.meta.url)
    ).text();
    expect(sql).toContain("DELETE FROM app_config WHERE key = 'large_transaction_threshold'");
    expect(sql).toContain("json_object('largeTransactionThreshold'");
    expect(sql).toContain(
      "INSERT INTO notification_rule_settings (rule_key, user_id, enabled, metadata)"
    );
    expect(sql).toContain("SELECT 'large_transaction', NULL, 1,");
  });

  test("notification_rule_settings allows at most one household row and one row per person, per rule", () => {
    const schema = db
      .query(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notification_rule_settings'"
      )
      .all() as { sql: string }[];
    const indexSql = schema.map((r) => r.sql).join("\n");
    expect(indexSql).toContain("WHERE user_id IS NULL");
    expect(indexSql).toContain("WHERE user_id IS NOT NULL");
  });
});
