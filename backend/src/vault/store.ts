import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "../config";
import type { WrappedKey } from "./crypto";

export interface VaultFile {
  version: 1;
  password: WrappedKey;
  recovery: WrappedKey;
}

// Lives next to the (encrypted) database file itself, never inside it — has
// to be readable before the database can even be opened. This file is
// exactly as sensitive as the password + recovery code combined: lose it
// (even with the .sqlite file intact) and both become useless, since they
// only unwrap copies stored here. Back up the whole data/ directory as one
// unit, not just this file or just the database.
const vaultPath = join(dirname(config.dbPath), "vault.json");

export function vaultFileExists(): boolean {
  return existsSync(vaultPath);
}

export function readVaultFile(): VaultFile | null {
  if (!existsSync(vaultPath)) return null;
  return JSON.parse(readFileSync(vaultPath, "utf-8")) as VaultFile;
}

export function writeVaultFile(data: VaultFile): void {
  writeFileSync(vaultPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  // writeFileSync's mode only applies on create — chmod explicitly too, in
  // case this is an overwrite (regenerate-recovery-code, change-password) of
  // a pre-existing file that somehow had looser permissions.
  chmodSync(vaultPath, 0o600);
}
