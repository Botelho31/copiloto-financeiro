import { getDb } from "../db";

// The full internal shape — used by other backend modules (projection
// shortfall threshold), never sent to the frontend as-is.
export interface AppConfigValues {
  minBuffer: number;
}

export async function getAppConfig(): Promise<AppConfigValues> {
  const result = await getDb().execute({
    sql: "SELECT value FROM app_config WHERE key = 'min_buffer'",
    args: [],
  });
  const row = result.rows[0] as unknown as { value: string } | undefined;
  return { minBuffer: row ? Number(row.value) : 0 };
}

export async function updateAppConfig(partial: Partial<AppConfigValues>): Promise<AppConfigValues> {
  if (partial.minBuffer !== undefined) {
    await getDb().execute({
      sql: `INSERT INTO app_config (key, value) VALUES ('min_buffer', ?)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      args: [String(partial.minBuffer)],
    });
  }
  return getAppConfig();
}
