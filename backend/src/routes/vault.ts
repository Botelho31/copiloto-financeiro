import { Elysia } from "elysia";
import { z } from "zod";
import {
  changePassword,
  getDb,
  hasVault,
  isUnlocked,
  lock,
  regenerateRecoveryCode,
  setupVault,
  unlock,
  unlockWithRecovery,
} from "../db";
import { generateApiKey, generateToken, hashApiKey, safeEqual } from "../vault/crypto";

export const SESSION_COOKIE_NAME = "vault_session";

// Not `secure: true` — this app serves plain HTTP on localhost by design
// (see ARCHITECTURE.md's Deployment section; no reverse-proxy/TLS framing
// now that auth was removed in favor of this), so `secure` would simply
// never let the browser send the cookie back at all.
const sessionCookieOptions = { httpOnly: true, sameSite: "strict" as const, path: "/" };

// In-memory only, regenerated on every setup/unlock, cleared on lock — never
// persisted, never the same secret as an API key (see vault/crypto.ts for why
// those are a deliberately separate, stable mechanism). This is what every
// `/api/*` request's session cookie is checked against.
let currentSessionToken: string | null = null;

export function isValidSession(token: string | undefined): boolean {
  return !!token && !!currentSessionToken && safeEqual(token, currentSessionToken);
}

// API keys are stable (routes/vault.ts never rotates or deletes them on
// lock/unlock) — the actual access gate is isUnlocked(), checked by the
// caller (the Elysia lock-gate in index.ts) before this is ever reached, so
// by the time we're hashing and looking up a key the database is already
// known to be open.
export async function isValidApiKey(key: string | undefined): Promise<boolean> {
  if (!key) return false;
  const hash = hashApiKey(key);
  const result = await getDb().execute({
    sql: "SELECT id FROM api_keys WHERE key_hash = ?",
    args: [hash],
  });
  const row = result.rows[0];
  if (!row) return false;
  await getDb().execute({
    sql: "UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?",
    args: [row.id],
  });
  return true;
}

const SetupBody = z.object({ password: z.string().min(8) });
const UnlockBody = z.union([
  z.object({ password: z.string().min(1) }),
  z.object({ recoveryCode: z.string().min(1) }),
]);
const PasswordOnlyBody = z.object({ password: z.string().min(1) });
const ApiKeyCreateBody = z.object({ name: z.string().min(1) });

function startSession(cookie: Record<string, { set: (opts: object) => void }>): void {
  currentSessionToken = generateToken();
  cookie[SESSION_COOKIE_NAME]?.set({ value: currentSessionToken, ...sessionCookieOptions });
}

export const vaultRoutes = new Elysia({ prefix: "/api/vault" })
  .get("/status", () => ({ hasVault: hasVault(), unlocked: isUnlocked() }))
  .post("/setup", async ({ body, cookie, set }) => {
    try {
      const { password } = SetupBody.parse(body);
      const { recoveryCode } = await setupVault(password);
      startSession(cookie);
      return { recoveryCode };
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? error.message : String(error) };
    }
  })
  .post("/unlock", async ({ body, cookie, set }) => {
    try {
      const input = UnlockBody.parse(body);
      if ("password" in input) {
        await unlock(input.password);
      } else {
        await unlockWithRecovery(input.recoveryCode);
      }
      startSession(cookie);
      return { ok: true };
    } catch {
      // Deliberately generic — never reveal whether a vault exists, whether
      // the password or the recovery code was the wrong one, etc.
      set.status = 401;
      return { error: "Wrong password or recovery code" };
    }
  })
  .post("/lock", ({ cookie }) => {
    lock();
    currentSessionToken = null;
    cookie[SESSION_COOKIE_NAME]?.remove();
    return { ok: true };
  })
  .post("/regenerate-recovery-code", async ({ body, set }) => {
    try {
      const { password } = PasswordOnlyBody.parse(body);
      const recoveryCode = await regenerateRecoveryCode(password);
      return { recoveryCode };
    } catch {
      set.status = 401;
      return { error: "Wrong password" };
    }
  })
  .post("/change-password", async ({ body, set }) => {
    try {
      const { currentPassword, newPassword } = z
        .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) })
        .parse(body);
      await changePassword(currentPassword, newPassword);
      return { ok: true };
    } catch {
      set.status = 401;
      return { error: "Wrong current password" };
    }
  })
  .get("/api-keys", async () => {
    const result = await getDb().execute(
      "SELECT id, name, created_at, last_used_at FROM api_keys ORDER BY created_at DESC"
    );
    return result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
    }));
  })
  .post("/api-keys", async ({ body, set }) => {
    try {
      const { name } = ApiKeyCreateBody.parse(body);
      const key = generateApiKey();
      const result = await getDb().execute({
        sql: "INSERT INTO api_keys (name, key_hash) VALUES (?, ?)",
        args: [name, hashApiKey(key)],
      });
      return { id: Number(result.lastInsertRowid), name, key };
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? error.message : String(error) };
    }
  })
  .delete("/api-keys/:id", async ({ params }) => {
    await getDb().execute({ sql: "DELETE FROM api_keys WHERE id = ?", args: [Number(params.id)] });
    return { ok: true };
  });
