import { describe, expect, test } from "bun:test";
import { getDb } from "./index";

// The preload script (backend/src/test/preload.ts) already called
// setupVault() before any test file was imported, which is what actually
// ran every migration for real (see db/index.ts's openAndMigrate) — this
// file just asserts the result looks right.
describe("migrations", () => {
  test("apply cleanly and are all recorded", async () => {
    const migrationsDir = new URL("./migrations", import.meta.url);
    const fileCount = Array.from(
      new Bun.Glob("*.sql").scanSync({ cwd: migrationsDir.pathname })
    ).length;
    const result = await getDb().execute("SELECT COUNT(*) as n FROM _migrations");
    const applied = result.rows[0] as unknown as { n: number };
    expect(applied.n).toBe(fileCount);
  });

  test("seeds the default categories", async () => {
    const result = await getDb().execute("SELECT name FROM categories ORDER BY name");
    const names = (result.rows as unknown as { name: string }[]).map((r) => r.name);
    expect(names).toContain("Uncategorized");
    expect(names).toContain("Transfers");
    expect(names).toContain("Savings & Investments");
    expect(names).toContain("Debt & Credit Card");
  });

  test("flags category behaviors instead of relying on the name (R5)", async () => {
    const db = getDb();
    const savingsResult = await db.execute({
      sql: "SELECT is_investment_transfer, is_card_bill_payment FROM categories WHERE name = ?",
      args: ["Savings & Investments"],
    });
    const savings = savingsResult.rows[0] as unknown as {
      is_investment_transfer: number;
      is_card_bill_payment: number;
    };
    expect(savings.is_investment_transfer).toBe(1);
    expect(savings.is_card_bill_payment).toBe(0);

    const cardResult = await db.execute({
      sql: "SELECT is_investment_transfer, is_card_bill_payment FROM categories WHERE name = ?",
      args: ["Debt & Credit Card"],
    });
    const card = cardResult.rows[0] as unknown as {
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

  test("app_settings is keyed by (user_id, key), not just key", async () => {
    const result = await getDb().execute(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'"
    );
    const schema = result.rows[0] as unknown as { sql: string };
    expect(schema.sql).toContain("user_id");
    expect(schema.sql).toContain("PRIMARY KEY (user_id, key)");
  });
});
