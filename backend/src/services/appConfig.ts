import { db } from "../db";

// The full internal shape, including real secret values — used by other
// backend modules (cron scheduling, notification rules/providers,
// projection shortfall threshold), never sent to the frontend as-is.
export interface AppConfigValues {
  cronSchedule: string;
  minBuffer: number;
  largeTransactionThreshold: number;
  pushoverAppToken: string | null;
  smtpHost: string | null;
  smtpPort: number;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpFrom: string | null;
}

const DEFAULTS: AppConfigValues = {
  cronSchedule: "0 6 * * *",
  minBuffer: 0,
  largeTransactionThreshold: 500,
  pushoverAppToken: null,
  smtpHost: null,
  smtpPort: 587,
  smtpUser: null,
  smtpPass: null,
  smtpFrom: null,
};

// Maps each camelCase field to its snake_case row key in app_config.
const FIELD_TO_KEY: Record<keyof AppConfigValues, string> = {
  cronSchedule: "cron_schedule",
  minBuffer: "min_buffer",
  largeTransactionThreshold: "large_transaction_threshold",
  pushoverAppToken: "pushover_app_token",
  smtpHost: "smtp_host",
  smtpPort: "smtp_port",
  smtpUser: "smtp_user",
  smtpPass: "smtp_pass",
  smtpFrom: "smtp_from",
};

const NUMERIC_FIELDS = new Set<keyof AppConfigValues>([
  "minBuffer",
  "largeTransactionThreshold",
  "smtpPort",
]);

export function getAppConfig(): AppConfigValues {
  const rows = db.query("SELECT key, value FROM app_config").all() as {
    key: string;
    value: string | null;
  }[];
  const raw = new Map(rows.map((r) => [r.key, r.value]));

  const result = { ...DEFAULTS };
  for (const field of Object.keys(FIELD_TO_KEY) as (keyof AppConfigValues)[]) {
    const dbKey = FIELD_TO_KEY[field];
    if (!raw.has(dbKey)) continue;
    const value = raw.get(dbKey);
    if (value === null) continue;
    (result as Record<string, unknown>)[field] = NUMERIC_FIELDS.has(field) ? Number(value) : value;
  }
  return result;
}

// Blank/undefined leaves a field unchanged (matches the Pluggy secret
// convention in routes/users.ts) — there's no "clear it" gesture for any of
// these today since every field has a sensible default to fall back to.
export function updateAppConfig(partial: Partial<AppConfigValues>): AppConfigValues {
  for (const field of Object.keys(FIELD_TO_KEY) as (keyof AppConfigValues)[]) {
    if (!(field in partial)) continue;
    const value = partial[field];
    if (value === undefined || value === "") continue;
    db.query(
      `INSERT INTO app_config (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    ).run(FIELD_TO_KEY[field], String(value));
  }
  return getAppConfig();
}

// One-time migration path: an existing deployment's .env values are copied
// into app_config the first time the table is empty, so upgrading doesn't
// silently reset a cron schedule or SMTP relay someone already had working.
// No-ops on every later boot once the table has at least one row.
export function seedAppConfigFromEnv(env: NodeJS.ProcessEnv): void {
  const hasAnyRow =
    (db.query("SELECT key FROM app_config LIMIT 1").get() as { key: string } | null) != null;
  if (hasAnyRow) return;

  const fromEnv: Partial<AppConfigValues> = {
    cronSchedule: env.CRON_SCHEDULE,
    minBuffer: env.MIN_BUFFER != null ? Number(env.MIN_BUFFER) : undefined,
    largeTransactionThreshold:
      env.LARGE_TRANSACTION_THRESHOLD != null ? Number(env.LARGE_TRANSACTION_THRESHOLD) : undefined,
    pushoverAppToken: env.PUSHOVER_APP_TOKEN,
    smtpHost: env.SMTP_HOST,
    smtpPort: env.SMTP_PORT != null ? Number(env.SMTP_PORT) : undefined,
    smtpUser: env.SMTP_USER,
    smtpPass: env.SMTP_PASS,
    smtpFrom: env.SMTP_FROM,
  };
  const hadAnything = Object.values(fromEnv).some((v) => v !== undefined && v !== "");
  updateAppConfig(fromEnv);
  if (hadAnything) console.log("[db] seeded app_config from existing .env values");
}
