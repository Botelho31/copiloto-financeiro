import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export const db = new Database(config.dbPath, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db
      .query("SELECT name FROM _migrations")
      .all()
      .map((row) => (row as { name: string }).name)
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    db.transaction(() => {
      db.exec(sql);
      db.query("INSERT INTO _migrations (name) VALUES (?)").run(file);
    })();
    console.log(`[db] applied migration ${file}`);
  }
}

runMigrations();

// One-time bootstrap: copy the old single-tenant .env Pluggy credentials onto
// the seeded "Me" user (id=1, see 021_users.sql) the first time they're
// missing from the DB, so an existing deployment doesn't lose its connection
// when upgrading to multi-user. No-ops once the user row has credentials.
function bootstrapDefaultUserCredentials() {
  if (!config.pluggyClientId || !config.pluggyClientSecret) return;
  const row = db.query("SELECT pluggy_client_id FROM users WHERE id = 1").get() as {
    pluggy_client_id: string | null;
  } | null;
  if (!row || row.pluggy_client_id) return;
  db.query(
    "UPDATE users SET pluggy_client_id = ?, pluggy_client_secret = ?, pluggy_item_ids = ? WHERE id = 1"
  ).run(config.pluggyClientId, config.pluggyClientSecret, config.pluggyItemIds.join(","));
  console.log("[db] bootstrapped default user's Pluggy credentials from .env");
}

bootstrapDefaultUserCredentials();
