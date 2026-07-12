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
};
