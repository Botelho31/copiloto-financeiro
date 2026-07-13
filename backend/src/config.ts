function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// Everything else that used to live here (Pluggy bootstrap credentials, cron
// schedule, notification thresholds/providers) is now DB-backed and editable
// from /config — see services/appConfig.ts. These four stay in .env since
// they're needed before the DB is even readable.
export const config = {
  isDev: process.env.NODE_ENV === "development",
  port: Number(process.env.PORT ?? "3000"),
  dbPath: process.env.DB_PATH ?? "./data/budget.sqlite",
  sessionSecret: required("SESSION_SECRET"),
};
