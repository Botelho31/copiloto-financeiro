import { Elysia } from "elysia";
import { z } from "zod";
import type {
  Notification,
  NotificationProviderConfig,
  NotificationRuleSettings,
  ProviderTestResult,
} from "shared";
import { db } from "../db";
import { parseUserId } from "../lib/scope";
import { PROVIDER_HANDLERS } from "../services/notifications/providers";
import { deleteRuleRow, listRuleRows, upsertRuleSettings } from "../services/notifications/rules";

interface NotificationRow {
  id: number;
  user_id: number;
  rule_key: string;
  severity: string;
  title: string;
  body: string;
  data: string | null;
  created_at: string;
  read_at: string | null;
}

function rowToNotification(r: NotificationRow): Notification {
  return {
    id: r.id,
    user_id: r.user_id,
    rule_key: r.rule_key,
    severity: r.severity as Notification["severity"],
    title: r.title,
    body: r.body,
    data: r.data ? JSON.parse(r.data) : null,
    created_at: r.created_at,
    read_at: r.read_at,
  };
}

export function listNotifications(userId: number | null, unreadOnly: boolean): Notification[] {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (userId != null) {
    conditions.push("user_id = ?");
    params.push(userId);
  }
  if (unreadOnly) conditions.push("read_at IS NULL");
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .query(`SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT 100`)
    .all(...(params as [])) as NotificationRow[];
  return rows.map(rowToNotification);
}

export function markNotificationRead(id: number): void {
  db.query(
    "UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL"
  ).run(id);
}

interface ProviderRow {
  id: number;
  user_id: number;
  provider: string;
  config: string;
  enabled: number;
  created_at: string;
}

function rowToProvider(r: ProviderRow): NotificationProviderConfig {
  return {
    id: r.id,
    user_id: r.user_id,
    provider: r.provider,
    config: JSON.parse(r.config),
    enabled: r.enabled === 1,
    created_at: r.created_at,
  };
}

export function listNotificationProviders(userId: number): NotificationProviderConfig[] {
  const rows = db
    .query("SELECT * FROM notification_providers WHERE user_id = ? ORDER BY provider ASC")
    .all(userId) as ProviderRow[];
  return rows.map(rowToProvider);
}

// Provider-specific config shapes — a new provider adds one more branch
// here and a matching handler in services/notifications/providers.
const ProviderConfigSchemas = {
  pushover: z.object({ userKey: z.string().min(1) }),
  email: z.object({ address: z.string().email() }),
  callmebot: z.object({ phone: z.string().min(1), apikey: z.string().min(1) }),
} as const;

export const UpsertProviderBody = z.union([
  z.object({
    userId: z.number().int(),
    provider: z.literal("pushover"),
    config: ProviderConfigSchemas.pushover,
    enabled: z.boolean().optional(),
  }),
  z.object({
    userId: z.number().int(),
    provider: z.literal("email"),
    config: ProviderConfigSchemas.email,
    enabled: z.boolean().optional(),
  }),
  z.object({
    userId: z.number().int(),
    provider: z.literal("callmebot"),
    config: ProviderConfigSchemas.callmebot,
    enabled: z.boolean().optional(),
  }),
]);
export type UpsertProviderInput = z.infer<typeof UpsertProviderBody>;

export function upsertNotificationProvider(
  input: UpsertProviderInput
): NotificationProviderConfig[] {
  db.query(
    `INSERT INTO notification_providers (user_id, provider, config, enabled)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, provider) DO UPDATE SET
       config = excluded.config,
       enabled = excluded.enabled`
  ).run(
    input.userId,
    input.provider,
    JSON.stringify(input.config),
    input.enabled === false ? 0 : 1
  );
  return listNotificationProviders(input.userId);
}

export function deleteNotificationProvider(id: number): void {
  db.query("DELETE FROM notification_providers WHERE id = ?").run(id);
}

export const TestProviderBody = z.union([
  z.object({ providerId: z.number().int() }),
  z.object({ provider: z.literal("pushover"), config: ProviderConfigSchemas.pushover }),
  z.object({ provider: z.literal("email"), config: ProviderConfigSchemas.email }),
  z.object({ provider: z.literal("callmebot"), config: ProviderConfigSchemas.callmebot }),
]);
export type TestProviderInput = z.infer<typeof TestProviderBody>;

export async function testNotificationProvider(
  input: TestProviderInput
): Promise<ProviderTestResult> {
  let provider: string;
  let providerConfig: Record<string, unknown>;
  if ("providerId" in input) {
    const row = db
      .query("SELECT provider, config FROM notification_providers WHERE id = ?")
      .get(input.providerId) as { provider: string; config: string } | null;
    if (!row) return { ok: false, error: `Provider ${input.providerId} not found` };
    provider = row.provider;
    providerConfig = JSON.parse(row.config);
  } else {
    provider = input.provider;
    providerConfig = input.config;
  }

  const handler = PROVIDER_HANDLERS[provider];
  if (!handler) return { ok: false, error: `Unknown provider: ${provider}` };
  const result = await handler.send(providerConfig, {
    title: "Test notification",
    body: "This is a test notification from your budget tracker.",
  });
  return result.ok ? { ok: true } : { ok: false, error: result.error ?? "Unknown error" };
}

// Every row that actually exists — household defaults (userId: null) and
// any per-person overrides — so the settings UI can render both at once
// without a round-trip per person.
export function listRuleSettings(): NotificationRuleSettings[] {
  return listRuleRows();
}

export const UpdateRuleSettingsBody = z.object({
  enabled: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateRuleSettingsInput = z.infer<typeof UpdateRuleSettingsBody>;

export function updateRuleSettingsForKey(
  ruleKey: string,
  userId: number | null,
  input: UpdateRuleSettingsInput
): NotificationRuleSettings {
  return upsertRuleSettings(ruleKey, userId, input);
}

export const notificationsRoutes = new Elysia({ prefix: "/api/notifications" })
  .get("/", ({ query }) => listNotifications(parseUserId(query), query.unreadOnly === "true"))
  .post("/:id/read", ({ params }) => {
    markNotificationRead(Number(params.id));
    return { ok: true };
  })
  .get("/providers", ({ query, set }) => {
    const userId = parseUserId(query);
    if (userId == null) {
      set.status = 400;
      return { error: "userId is required" };
    }
    return listNotificationProviders(userId);
  })
  .post("/providers", ({ body }) => upsertNotificationProvider(body), {
    body: UpsertProviderBody,
  })
  .delete("/providers/:id", ({ params }) => {
    deleteNotificationProvider(Number(params.id));
    return { ok: true };
  })
  .post("/providers/test", ({ body }) => testNotificationProvider(body), {
    body: TestProviderBody,
  })
  .get("/rules", () => listRuleSettings())
  .patch(
    "/rules/:key",
    ({ params, query, body, set }) => {
      try {
        return updateRuleSettingsForKey(params.key, parseUserId(query), body);
      } catch (e) {
        set.status = 400;
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
    { body: UpdateRuleSettingsBody }
  )
  .delete("/rules/:key", ({ params, query, set }) => {
    try {
      deleteRuleRow(params.key, parseUserId(query));
      return { ok: true };
    } catch (e) {
      set.status = 400;
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
