import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Must run (and finish setting env vars) before any test file imports
// anything that touches ../db or ../config — see bunfig.toml. A fresh temp
// directory per test run, so a real SQLite file gets created and migrated
// (not mocked), and re-running the suite never touches the previous run's
// leftover file/WAL journal.
const dir = mkdtempSync(join(tmpdir(), "budget-tracker-test-"));
process.env.DB_PATH = join(dir, "test.sqlite");

// setupVault() both creates the encrypted test DB and runs every migration
// against it (see db/index.ts) — replaces the old eager-migration-on-import
// behavior. Every test file shares this one unlocked vault for the whole
// run; resetDb() (test/helpers.ts) clears data tables between tests, it
// never re-locks or re-creates the vault itself. Top-level await here blocks
// every later import in the preload chain until this resolves, same ordering
// guarantee the old synchronous bun:sqlite open used to give for free.
const { setupVault } = await import("../db");
await setupVault("test-password-not-secret");
