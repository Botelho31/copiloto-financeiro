import { Elysia } from "elysia";
import type { AppSettings } from "shared";
import { db } from "../db";

export function getSettings(): AppSettings {
  const row = db.query("SELECT value FROM app_settings WHERE key = 'cardSpendGoal'").get() as
    | { value: string }
    | null;
  return { cardSpendGoal: row ? Number(row.value) : null };
}

export const settingsRoutes = new Elysia({ prefix: "/api/settings" })
  .get("/", () => getSettings())
  .patch("/", ({ body }) => {
    const input = body as Partial<{ cardSpendGoal: number | null }>;
    if (input.cardSpendGoal !== undefined) {
      if (input.cardSpendGoal === null) {
        db.query("DELETE FROM app_settings WHERE key = 'cardSpendGoal'").run();
      } else {
        db.query(
          "INSERT INTO app_settings (key, value) VALUES ('cardSpendGoal', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).run(String(input.cardSpendGoal));
      }
    }
    return getSettings();
  });
