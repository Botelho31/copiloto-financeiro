import { createClient, type Client } from "@libsql/client";
import { Database as PlaintextDatabase } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config";
import { generateMasterKey, generateRecoveryCode, unwrapKey, wrapKey } from "../vault/crypto";
import { readVaultFile, vaultFileExists, writeVaultFile, type VaultFile } from "../vault/store";

// Deliberately a lazy, function-body-only import of jobs/dailySync.ts (which
// itself imports getDb from this file) — safe because neither side touches
// the other's export at module-evaluation time, only inside functions called
// well after both modules have finished loading.
async function maybeSyncOnUnlock(): Promise<void> {
  const { isStale, triggerSync, usersWithPluggyCredentials } = await import("../jobs/dailySync");
  const users = await usersWithPluggyCredentials();
  const staleness = await Promise.all(users.map((u) => isStale(u.id)));
  if (staleness.some(Boolean)) {
    await triggerSync("unlock");
  }
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

// The only place the open connection (and transitively, the decryption key)
// lives — module-level, process-lifetime, cleared on lock(). Nothing else in
// the backend should hold a reference to a Client beyond what getDb() hands
// back on each call.
let client: Client | null = null;

export function isUnlocked(): boolean {
  return client != null;
}

export function hasVault(): boolean {
  return vaultFileExists();
}

// Every route/service in this app expects the Elysia lock-gate to have
// already checked isUnlocked() before it runs — reaching here while locked
// means that gate was bypassed or missing, which is itself a bug worth
// throwing loudly for rather than returning something empty-but-valid-looking.
export function getDb(): Client {
  if (!client) throw new Error("Vault is locked — call unlock() first");
  return client;
}

async function runMigrations(db: Client): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const appliedResult = await db.execute("SELECT name FROM _migrations");
  const applied = new Set(appliedResult.rows.map((row) => row.name as string));

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    const tx = await db.transaction();
    try {
      await tx.executeMultiple(sql);
      await tx.execute({ sql: "INSERT INTO _migrations (name) VALUES (?)", args: [file] });
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    console.log(`[db] applied migration ${file}`);
  }
}

// Already correctly populated by this file's own migration run (see
// runMigrations above) — copying the old file's own copy of these would
// either duplicate rows or conflict on primary key. Not real user data.
const SKIP_TABLES_ON_MIGRATE = new Set(["_migrations", "sqlite_sequence"]);

// A pre-existing plaintext data/budget.sqlite (from before this app
// encrypted its database) can't be opened directly with an encryptionKey —
// libSQL rejects a plaintext file outright (confirmed: SQLITE_NOTADB, not
// "encrypt it in place"). setupVault() below renames it aside first so a
// brand-new encrypted file gets created at the real path with a full fresh
// schema (via the normal migration run), then this copies every row across
// from the renamed-aside plaintext copy, table by table, via bun:sqlite
// (always available — a Bun built-in, not an extra dependency).
async function migratePlaintextData(plaintextPath: string, newDb: Client): Promise<void> {
  const oldDb = new PlaintextDatabase(plaintextPath);
  try {
    const tables = oldDb
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];

    await newDb.execute("PRAGMA foreign_keys = OFF;");
    for (const { name } of tables) {
      if (SKIP_TABLES_ON_MIGRATE.has(name)) continue;
      const rows = oldDb.query(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0]!);
      // OR REPLACE, not plain INSERT: some tables (e.g. categories) get
      // default rows from the migrations that just ran against the brand
      // new file (see runMigrations above) — the old file is the
      // authoritative source (it may hold user edits to those same rows),
      // so its copy must win on a primary-key collision, not conflict.
      const sql = `INSERT OR REPLACE INTO "${name}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
      const tx = await newDb.transaction();
      try {
        for (const row of rows) {
          await tx.execute({ sql, args: columns.map((c) => row[c]) as never[] });
        }
        await tx.commit();
      } catch (err) {
        await tx.rollback();
        throw err;
      }
      console.log(`[db] migrated ${rows.length} row(s) from "${name}" into the encrypted database`);
    }
    await newDb.execute("PRAGMA foreign_keys = ON;");
  } finally {
    oldDb.close();
  }
}

async function openAndMigrate(masterKey: Buffer): Promise<Client> {
  const db = createClient({
    url: `file:${config.dbPath}`,
    encryptionKey: masterKey.toString("hex"),
  });
  await db.execute("PRAGMA journal_mode = WAL;");
  await db.execute("PRAGMA foreign_keys = ON;");
  await runMigrations(db);
  return db;
}

// One-time: no vault exists yet. Generates the real encryption key (MK) and
// a recovery code, wraps MK under both the password and the recovery code
// independently (see vault/crypto.ts), and opens the now-encrypted database
// for the first time. The recovery code is returned exactly once — nothing
// in this app can ever show it again after this call returns.
export async function setupVault(password: string): Promise<{ recoveryCode: string }> {
  if (vaultFileExists()) {
    throw new Error("A vault already exists — use unlock(), not setupVault()");
  }
  const mk = generateMasterKey();
  const recoveryCode = generateRecoveryCode();
  const vault: VaultFile = {
    version: 1,
    password: wrapKey(password, mk),
    recovery: wrapKey(recoveryCode, mk),
  };

  // An existing plaintext database (an install from before encryption)
  // needs to be moved out of the way before openAndMigrate below can create
  // a fresh encrypted file at the real path — see migratePlaintextData's
  // own comment for why it can't just be opened with a key in place.
  let plaintextToMigrate: string | null = null;
  if (existsSync(config.dbPath)) {
    plaintextToMigrate = `${config.dbPath}.pre-encryption`;
    renameSync(config.dbPath, plaintextToMigrate);
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(config.dbPath + suffix)) {
        renameSync(config.dbPath + suffix, plaintextToMigrate + suffix);
      }
    }
  }

  writeVaultFile(vault);
  client = await openAndMigrate(mk);
  if (plaintextToMigrate) {
    await migratePlaintextData(plaintextToMigrate, client);
  }
  return { recoveryCode };
}

async function unlockWith(secret: string, which: "password" | "recovery"): Promise<void> {
  const vault = readVaultFile();
  if (!vault) throw new Error("No vault exists yet — call setupVault() first");
  // unwrapKey throws on a wrong secret (GCM auth-tag failure) — that failure
  // IS the verification. The resulting mk never reaches openAndMigrate/libSQL
  // unless it was already proven correct in memory, by design (see the
  // invariant documented in vault/crypto.ts).
  const mk = unwrapKey(secret, vault[which]);
  client = await openAndMigrate(mk);
  // Fire-and-forget — unlocking shouldn't block on however long a real sync
  // takes. Errors are logged inside triggerSync itself per-person; nothing
  // here should ever throw past this point and fail the unlock that already
  // succeeded.
  void maybeSyncOnUnlock().catch((err) =>
    console.error("[sync] sync-on-unlock check failed:", err)
  );
}

export async function unlock(password: string): Promise<void> {
  await unlockWith(password, "password");
}

export async function unlockWithRecovery(recoveryCode: string): Promise<void> {
  await unlockWith(recoveryCode, "recovery");
}

export function lock(): void {
  client?.close();
  client = null;
}

// Re-wraps MK under a freshly generated recovery code — the old code stops
// working the instant this returns. Requires the current password first,
// same reasoning as changing a password anywhere: proving you still know the
// current secret before minting a new one.
export async function regenerateRecoveryCode(password: string): Promise<string> {
  const vault = readVaultFile();
  if (!vault) throw new Error("No vault exists yet");
  const mk = unwrapKey(password, vault.password);
  const recoveryCode = generateRecoveryCode();
  writeVaultFile({ ...vault, recovery: wrapKey(recoveryCode, mk) });
  return recoveryCode;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const vault = readVaultFile();
  if (!vault) throw new Error("No vault exists yet");
  const mk = unwrapKey(currentPassword, vault.password);
  writeVaultFile({ ...vault, password: wrapKey(newPassword, mk) });
}
