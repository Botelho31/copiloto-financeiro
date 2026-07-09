function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  isDev: process.env.NODE_ENV === "development",
  pluggyClientId: required("PLUGGY_CLIENT_ID"),
  pluggyClientSecret: required("PLUGGY_CLIENT_SECRET"),
  pluggyItemIds: required("PLUGGY_ITEM_IDS")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
  cronSchedule: process.env.CRON_SCHEDULE ?? "0 6 * * *",
  minBuffer: Number(process.env.MIN_BUFFER ?? "0"),
  port: Number(process.env.PORT ?? "3000"),
  dbPath: process.env.DB_PATH ?? "./data/budget.sqlite",
  sessionSecret: required("SESSION_SECRET"),
};
