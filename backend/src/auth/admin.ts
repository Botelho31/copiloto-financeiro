import { db } from "../db";
import { hashPassword, verifyPassword } from "./password";

interface AdminRow {
  username: string;
  password_hash: string;
}

export function hasAdmin(): boolean {
  return !!db.query("SELECT id FROM admin WHERE id = 1").get();
}

export async function createAdmin(username: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  db.query("INSERT INTO admin (id, username, password_hash) VALUES (1, ?, ?)").run(
    username,
    passwordHash
  );
}

export async function verifyAdmin(username: string, password: string): Promise<boolean> {
  const row = db.query("SELECT username, password_hash FROM admin WHERE id = 1").get() as
    | AdminRow
    | null;
  if (!row || row.username !== username) return false;
  return verifyPassword(password, row.password_hash);
}
