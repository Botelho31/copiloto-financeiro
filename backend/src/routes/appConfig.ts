import { Elysia } from "elysia";
import { z } from "zod";
import type { AppConfig } from "shared";
import { getAppConfig, updateAppConfig } from "../services/appConfig";
import { rescheduleCron } from "../jobs/dailySync";

// Never sent to the frontend raw — mirrors the hasPluggyCredentials
// convention in routes/users.ts.
export function getPublicAppConfig(): AppConfig {
  const full = getAppConfig();
  return {
    cronSchedule: full.cronSchedule,
    minBuffer: full.minBuffer,
    largeTransactionThreshold: full.largeTransactionThreshold,
    hasPushoverAppToken: full.pushoverAppToken != null,
    smtpHost: full.smtpHost,
    smtpPort: full.smtpPort,
    smtpUser: full.smtpUser,
    smtpFrom: full.smtpFrom,
    hasSmtpPass: full.smtpPass != null,
  };
}

export const AppConfigUpdateBody = z.object({
  cronSchedule: z.string().min(1).optional(),
  minBuffer: z.number().optional(),
  largeTransactionThreshold: z.number().optional(),
  pushoverAppToken: z.string().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  smtpFrom: z.string().optional(),
});
export type AppConfigUpdateInput = z.infer<typeof AppConfigUpdateBody>;

export function updateAndReturnAppConfig(input: AppConfigUpdateInput): AppConfig {
  updateAppConfig(input);
  if (input.cronSchedule) rescheduleCron();
  return getPublicAppConfig();
}

export const appConfigRoutes = new Elysia({ prefix: "/api/app-config" })
  .get("/", () => getPublicAppConfig())
  .patch(
    "/",
    ({ body, set }) => {
      try {
        return updateAndReturnAppConfig(body);
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: AppConfigUpdateBody }
  );
