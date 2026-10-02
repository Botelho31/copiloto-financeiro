import { Elysia } from "elysia";
import { z } from "zod";
import type { AppSettings } from "shared";
import { getDb } from "../db";
import { parseUserId } from "../lib/scope";

async function personCardSpendGoal(userId: number): Promise<number | null> {
  const result = await getDb().execute({
    sql: "SELECT value FROM app_settings WHERE user_id = ? AND key = 'cardSpendGoal'",
    args: [userId],
  });
  const row = result.rows[0] as unknown as { value: string } | undefined;
  return row ? Number(row.value) : null;
}

// The household's card spend goal is the sum of every person's own goal —
// but only once everyone has explicitly set one, so a single person still
// on the historical average doesn't silently produce an understated total
// that reads as a deliberate, complete figure.
async function householdCardSpendGoal(): Promise<number | null> {
  const result = await getDb().execute("SELECT id FROM users");
  const users = result.rows as unknown as { id: number }[];
  if (users.length === 0) return null;
  let total = 0;
  for (const u of users) {
    const goal = await personCardSpendGoal(u.id);
    if (goal == null) return null;
    total += goal;
  }
  return total;
}

export async function getSettings(userId: number | null): Promise<AppSettings> {
  if (userId == null) return { cardSpendGoal: await householdCardSpendGoal() };
  return { cardSpendGoal: await personCardSpendGoal(userId) };
}

export const SettingsUpdateBody = z.object({ cardSpendGoal: z.number().nullable().optional() });
export type SettingsUpdateInput = z.infer<typeof SettingsUpdateBody>;

// Shared by the REST route and the MCP update_settings tool.
export async function updateSettings(
  userId: number,
  input: SettingsUpdateInput
): Promise<AppSettings> {
  if (input.cardSpendGoal !== undefined) {
    const db = getDb();
    if (input.cardSpendGoal === null) {
      await db.execute({
        sql: "DELETE FROM app_settings WHERE user_id = ? AND key = 'cardSpendGoal'",
        args: [userId],
      });
    } else {
      await db.execute({
        sql: "INSERT INTO app_settings (user_id, key, value) VALUES (?, 'cardSpendGoal', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
        args: [userId, String(input.cardSpendGoal)],
      });
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
