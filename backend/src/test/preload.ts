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
process.env.SESSION_SECRET = "test-session-secret";
// Pluggy credentials stay unset — sync/pluggy code isn't exercised by these
// tests, and config.ts only treats them as an optional one-time bootstrap.
process.env.PLUGGY_CLIENT_ID = "";
process.env.PLUGGY_CLIENT_SECRET = "";
process.env.PLUGGY_ITEM_IDS = "";
