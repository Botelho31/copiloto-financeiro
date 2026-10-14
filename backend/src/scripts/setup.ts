// First-run setup from the terminal — sets the vault password, generates
// the first MCP API key, and starts the server, all in one go. Exists so a
// human can do this themselves in one command instead of opening the
// browser for the password/API-key steps the get-started skill otherwise
// has to hand off to them (Claude can never choose or see the password —
// see vault/crypto.ts — so this script is meant to be run by a person in
// their own terminal, not invoked on their behalf).
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { config } from "../config";
import { getDb, hasVault, setupVault, unlock } from "../db";
import { generateApiKey, hashApiKey } from "../vault/crypto";

function readLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(prompt).finally(() => rl.close());
}

// No readline equivalent masks input, so this reads raw keystrokes itself —
// printing "*" per character, handling backspace/Ctrl-C — rather than
// echoing the password in plain text to the terminal. A single persistent
// listener feeds a character queue that readHiddenLine pulls from one line
// at a time: a naive "attach a listener, detach on the first newline"
// version silently drops everything after that newline whenever more than
// one line arrives in the same raw 'data' chunk — which pasted passwords
// (or, as it turns out, anything piped) routinely do.
function createHiddenLineReader() {
  if (!process.stdin.isTTY) {
    throw new Error("Needs an interactive terminal (stdin isn't a TTY).");
  }
  const stdin = process.stdin;
  const queue: string[] = [];
  let waiting: ((char: string) => void) | null = null;

  function onData(chunk: string) {
    for (const char of chunk) {
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve(char);
      } else {
        queue.push(char);
      }
    }
  }

  stdin.resume();
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.on("data", onData);

  function nextChar(): Promise<string> {
    const queued = queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      waiting = resolve;
    });
  }

  async function readHiddenLine(prompt: string): Promise<string> {
    process.stdout.write(prompt);
    let value = "";
    for (;;) {
      const char = await nextChar();
      if (char === "\n" || char === "\r") {
        process.stdout.write("\n");
        return value;
      }
      if (char === "\u0003") {
        process.stdout.write("\n");
        close();
        process.exit(130);
      }
      if (char === "\u007f" || char === "\b") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        }
        continue;
      }
      value += char;
      process.stdout.write("*");
    }
  }

  function close() {
    stdin.setRawMode(false);
    stdin.pause();
    stdin.removeListener("data", onData);
  }

  return { readHiddenLine, close };
}

async function promptNewPassword(): Promise<string> {
  const reader = createHiddenLineReader();
  try {
    for (;;) {
      const password = await reader.readHiddenLine("Choose a password (at least 8 characters): ");
      if (password.length < 8) {
        console.log("Too short — use at least 8 characters.\n");
        continue;
      }
      const confirm = await reader.readHiddenLine("Confirm password: ");
      if (confirm !== password) {
        console.log("Those didn't match — let's try again.\n");
        continue;
      }
      return password;
    }
  } finally {
    reader.close();
  }
}

// Only for unlocking an *existing* vault (to generate a missing API key
// below) — no confirmation, no length check, those only make sense when
// choosing a brand-new password.
async function promptExistingPassword(): Promise<string> {
  const reader = createHiddenLineReader();
  try {
    return await reader.readHiddenLine("Password: ");
  } finally {
    reader.close();
  }
}

async function ensureDeps(): Promise<void> {
  if (existsSync("node_modules")) return;
  console.log("Installing dependencies (bun install)...");
  const proc = Bun.spawn(["bun", "install"], { stdio: ["inherit", "inherit", "inherit"] });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error("bun install failed — fix that first.");
    process.exit(exitCode);
  }
}

// Same derivation as vault/store.ts (vault.json) and mcp-server.ts (reading
// it back) — next to the database, following a custom DB_PATH.
function mcpKeyPath(): string {
  return join(dirname(config.dbPath), "mcp-api-key");
}

async function createMcpApiKey(): Promise<string> {
  const key = generateApiKey();
  await getDb().execute({
    sql: "INSERT INTO api_keys (name, key_hash) VALUES (?, ?)",
    args: ["Claude Code (setup script)", hashApiKey(key)],
  });
  const keyPath = mcpKeyPath();
  writeFileSync(keyPath, key + "\n", { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  return keyPath;
}

// The backend starts in *this* process (imported, not spawned) so it
// inherits the vault we just unlocked above — a spawned child would open
// its own, separately-locked connection (see db/index.ts: the decryption
// key only ever lives in one process's memory, on purpose). The frontend
// dev server has nothing to do with the vault, so it's a plain child
// process, same as the root "dev" script's own concurrently call — it
// shares this terminal's process group, so Ctrl-C stops both together.
async function startApp(): Promise<void> {
  Bun.spawn(["bun", "run", "--cwd", "frontend", "dev"], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  await import("../index");
}

async function main(): Promise<void> {
  console.log("Copiloto Financeiro — setup\n");

  await ensureDeps();

  if (!existsSync(".env") && existsSync(".env.example")) {
    await Bun.write(".env", Bun.file(".env.example"));
    console.log("Created .env from .env.example.\n");
  }

  if (hasVault()) {
    if (existsSync(mcpKeyPath())) {
      console.log("A vault already exists — nothing to set up. Starting the app...\n");
      await startApp();
      return;
    }

    console.log(
      "A vault already exists, but there's no MCP API key on file yet.\n" +
        "Enter your password to unlock it and generate one."
    );
    const existingPassword = await promptExistingPassword();
    try {
      await unlock(existingPassword);
    } catch {
      console.error(
        "\nWrong password — can't generate a key without unlocking. Try again, or " +
          'generate one from the browser\'s /config → "API Keys" instead.'
      );
      process.exit(1);
    }
    const keyPath = await createMcpApiKey();
    console.log(`\nMCP API key generated and saved to ${keyPath}.\n`);
    console.log("Starting the app...\n");
    await startApp();
    return;
  }

  console.log(
    "This encrypts the database with a password only you know — not stored anywhere,\n" +
      "not visible to Claude. Losing both the password and the recovery code it shows\n" +
      "next means the data is gone for good, by design.\n"
  );
  const password = await promptNewPassword();
  console.log("\nSetting up the vault...");
  const { recoveryCode } = await setupVault(password);

  console.log("\n" + "─".repeat(60));
  console.log("RECOVERY CODE — the only way back in if you forget the password.");
  console.log("Shown once, right now, and never again. Save it somewhere safe:\n");
  console.log("  " + recoveryCode);
  console.log("─".repeat(60));
  await readLine("\nPress Enter once you've saved it: ");

  const keyPath = await createMcpApiKey();
  console.log(`\nMCP API key generated and saved to ${keyPath}.`);
  console.log("Claude Code can reach this app now, as long as it stays unlocked.\n");

  console.log("Starting the app...\n");
  await startApp();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
