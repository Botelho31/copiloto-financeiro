import { beforeEach, describe, expect, test } from "bun:test";
import { insertTestUser, resetDb } from "../test/helpers";
import { getSettings, updateSettings } from "./settings";

beforeEach(() => resetDb());

describe("getSettings — Household (userId null)", () => {
  test("is null when no one has set a card spend goal", async () => {
    await insertTestUser();
    await insertTestUser();
    expect((await getSettings(null)).cardSpendGoal).toBeNull();
  });

  test("is null when only some people have set a goal", async () => {
    const alice = await insertTestUser();
    await insertTestUser();
    await updateSettings(alice, { cardSpendGoal: 1000 });
    expect((await getSettings(null)).cardSpendGoal).toBeNull();
  });

  test("is the sum of everyone's goal once every person has set one", async () => {
    const alice = await insertTestUser();
    const bob = await insertTestUser();
    await updateSettings(alice, { cardSpendGoal: 1000 });
    await updateSettings(bob, { cardSpendGoal: 500 });
    expect((await getSettings(null)).cardSpendGoal).toBe(1500);
  });

  test("drops back to null if a goal is later cleared", async () => {
    const alice = await insertTestUser();
    const bob = await insertTestUser();
    await updateSettings(alice, { cardSpendGoal: 1000 });
    await updateSettings(bob, { cardSpendGoal: 500 });
    await updateSettings(bob, { cardSpendGoal: null });
    expect((await getSettings(null)).cardSpendGoal).toBeNull();
  });

  test("is null when there are no people at all", async () => {
    expect((await getSettings(null)).cardSpendGoal).toBeNull();
  });
});
