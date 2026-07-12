function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  isDev: process.env.NODE_ENV === "development",
  // Only used once, as a startup bootstrap: if the "Me" user (id=1) has no
  // Pluggy credentials in the DB yet, these are copied in so an existing
  // single-user deployment doesn't have to re-enter them via /config. Per-user
  // credentials otherwise live in the users table (see routes/users.ts).
  pluggyClientId: process.env.PLUGGY_CLIENT_ID,
  pluggyClientSecret: process.env.PLUGGY_CLIENT_SECRET,
  pluggyItemIds: (process.env.PLUGGY_ITEM_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
  cronSchedule: process.env.CRON_SCHEDULE ?? "0 6 * * *",
  minBuffer: Number(process.env.MIN_BUFFER ?? "0"),
  port: Number(process.env.PORT ?? "3000"),
  dbPath: process.env.DB_PATH ?? "./data/budget.sqlite",
  sessionSecret: required("SESSION_SECRET"),

  // Notification rule thresholds — app-wide, since a per-person override
  // isn't worth the complexity yet (add one if it's ever actually needed).
  largeTransactionThreshold: Number(process.env.LARGE_TRANSACTION_THRESHOLD ?? "500"),

  // Pushover: one application-level token for the whole deployment (from
  // pushover.net), paired with each person's own user key stored in
  // notification_providers.
  pushoverAppToken: process.env.PUSHOVER_APP_TOKEN,

  // Email: one SMTP relay for the whole deployment, paired with each
  // person's own destination address stored in notification_providers.
  smtpHost: process.env.SMTP_HOST,
  smtpPort: Number(process.env.SMTP_PORT ?? "587"),
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  smtpFrom: process.env.SMTP_FROM,
};
