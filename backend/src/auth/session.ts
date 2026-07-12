import { randomBytes } from "node:crypto";
import { db } from "../db";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_SECONDS = SESSION_DURATION_MS / 1000;
export const SESSION_COOKIE_NAME = "session_id";

export function createSession(): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  db.query("INSERT INTO sessions (id, expires_at) VALUES (?, ?)").run(
    token,
    expiresAt.toISOString()
  );
  return { token, expiresAt };
}

export function verifySession(token: string | undefined | null): boolean {
  if (!token) return false;
  const row = db.query("SELECT expires_at FROM sessions WHERE id = ?").get(token) as {
    expires_at: string;
  } | null;
  if (!row) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.query("DELETE FROM sessions WHERE id = ?").run(token);
    return false;
  }
  return true;
}

export function destroySession(token: string | undefined | null): void {
  if (!token) return;
  db.query("DELETE FROM sessions WHERE id = ?").run(token);
}
