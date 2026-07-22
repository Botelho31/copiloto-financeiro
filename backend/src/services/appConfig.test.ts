import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../db";
import { resetDb } from "../test/helpers";
import { getAppConfig, seedAppConfigFromEnv, updateAppConfig } from "./appConfig";

beforeEach(() => resetDb());

describe("getAppConfig", () => {
  test("falls back to defaults when app_config is empty", () => {
    expect(getAppConfig()).toMatchObject({
      cronSchedule: "0 6 * * *",
      minBuffer: 0,
      pushoverAppToken: null,
      smtpHost: null,
      smtpPort: 587,
      smtpUser: null,
      smtpPass: null,
      smtpFrom: null,
    });
  });
});

describe("updateAppConfig", () => {
  test("persists a partial update and coerces numeric fields back from TEXT storage", () => {
    const result = updateAppConfig({ cronSchedule: "0 8 * * *", minBuffer: 250 });
    expect(result.cronSchedule).toBe("0 8 * * *");
    expect(result.minBuffer).toBe(250);
    expect(typeof result.minBuffer).toBe("number");
  });

  test("a second update only touches the fields it sends", () => {
    updateAppConfig({ cronSchedule: "0 8 * * *" });
    const result = updateAppConfig({ minBuffer: 100 });
    expect(result.cronSchedule).toBe("0 8 * * *");
    expect(result.minBuffer).toBe(100);
  });

  test("a blank string leaves the existing value unchanged", () => {
    updateAppConfig({ pushoverAppToken: "real-token" });
    const result = updateAppConfig({ pushoverAppToken: "" });
    expect(result.pushoverAppToken).toBe("real-token");
  });
});

describe("seedAppConfigFromEnv", () => {
  test("copies env values in when app_config is empty", () => {
    seedAppConfigFromEnv({ CRON_SCHEDULE: "0 9 * * *", MIN_BUFFER: "42" } as NodeJS.ProcessEnv);
    const result = getAppConfig();
    expect(result.cronSchedule).toBe("0 9 * * *");
    expect(result.minBuffer).toBe(42);
  });

  test("does nothing once app_config already has a row", () => {
    updateAppConfig({ cronSchedule: "0 7 * * *" });
    seedAppConfigFromEnv({ CRON_SCHEDULE: "0 9 * * *" } as NodeJS.ProcessEnv);
    expect(getAppConfig().cronSchedule).toBe("0 7 * * *");
  });

  test("does nothing when no env vars are set", () => {
    seedAppConfigFromEnv({} as NodeJS.ProcessEnv);
    expect(db.query("SELECT key FROM app_config").all()).toHaveLength(0);
  });
});
