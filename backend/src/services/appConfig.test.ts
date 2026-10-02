import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "../test/helpers";
import { getAppConfig, updateAppConfig } from "./appConfig";

beforeEach(async () => await resetDb());

describe("getAppConfig", () => {
  test("falls back to defaults when app_config is empty", async () => {
    expect(await getAppConfig()).toMatchObject({
      minBuffer: 0,
    });
  });
});

describe("updateAppConfig", () => {
  test("persists a partial update and coerces numeric fields back from TEXT storage", async () => {
    const result = await updateAppConfig({ minBuffer: 250 });
    expect(result.minBuffer).toBe(250);
    expect(typeof result.minBuffer).toBe("number");
  });
});
