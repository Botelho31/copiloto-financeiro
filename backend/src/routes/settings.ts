import { Elysia } from "elysia";
import { z } from "zod";
import type { AppSettings } from "shared";
import { db } from "../db";
import { parseUserId } from "../lib/scope";

// null userId (Household) has no single settings row to point to — a
// cardSpendGoal is inherently personal, so Household just means "no override".
export function getSettings(userId: number | null): AppSettings {
  if (userId == null) return { cardSpendGoal: null };
  const row = db
    .query("SELECT value FROM app_settings WHERE user_id = ? AND key = 'cardSpendGoal'")
    .get(userId) as { value: string } | null;
  return { cardSpendGoal: row ? Number(row.value) : null };
}

export const SettingsUpdateBody = z.object({ cardSpendGoal: z.number().nullable().optional() });
export type SettingsUpdateInput = z.infer<typeof SettingsUpdateBody>;

// Shared by the REST route and the MCP update_settings tool.
export function updateSettings(userId: number, input: SettingsUpdateInput): AppSettings {
  if (input.cardSpendGoal !== undefined) {
    if (input.cardSpendGoal === null) {
      db.query("DELETE FROM app_settings WHERE user_id = ? AND key = 'cardSpendGoal'").run(userId);
    } else {
      db.query(
        "INSERT INTO app_settings (user_id, key, value) VALUES (?, 'cardSpendGoal', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value"
      ).run(userId, String(input.cardSpendGoal));
    }
  }
  return getSettings(userId);
}

export const settingsRoutes = new Elysia({ prefix: "/api/settings" })
  .get("/", ({ query }) => getSettings(parseUserId(query)))
  .patch(
    "/",
    ({ body, query, set }) => {
      const userId = parseUserId(query);
      if (userId == null) {
        set.status = 400;
        return { error: "userId is required" };
      }
      return updateSettings(userId, body);
    },
    { body: SettingsUpdateBody }
  );
