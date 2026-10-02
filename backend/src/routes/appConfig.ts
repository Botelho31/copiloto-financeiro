import { Elysia } from "elysia";
import { z } from "zod";
import type { AppConfig } from "shared";
import { getAppConfig, updateAppConfig } from "../services/appConfig";

// Never sent to the frontend raw — mirrors the hasPluggyCredentials
// convention in routes/users.ts.
export async function getPublicAppConfig(): Promise<AppConfig> {
  const full = await getAppConfig();
  return {
    minBuffer: full.minBuffer,
  };
}

export const AppConfigUpdateBody = z.object({
  minBuffer: z.number().optional(),
});
export type AppConfigUpdateInput = z.infer<typeof AppConfigUpdateBody>;

export async function updateAndReturnAppConfig(input: AppConfigUpdateInput): Promise<AppConfig> {
  await updateAppConfig(input);
  return getPublicAppConfig();
}

export const appConfigRoutes = new Elysia({ prefix: "/api/app-config" })
  .get("/", () => getPublicAppConfig())
  .patch(
    "/",
    async ({ body, set }) => {
      try {
        return await updateAndReturnAppConfig(body);
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: AppConfigUpdateBody }
  );
