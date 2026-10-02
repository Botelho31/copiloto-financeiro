import { beforeEach, describe, expect, test } from "bun:test";
import { insertTestAccount, insertTestInvestment, insertTestUser, resetDb } from "../test/helpers";
import { createGoal, listGoals } from "./goals";

beforeEach(() => resetDb());

describe("listGoals — net worth (bank + investments)", () => {
  // computeProjection's own startingBalance/months[].balance already fold
  // investmentsTotal in (see projectionEngine.ts) — computeGoal must read
  // that balance as-is rather than adding investmentsTotal a second time on
  // top of it, or every projection would double-count what's invested.
  test("doesn't double-count investment holdings in the projected net worth", async () => {
    const alice = await insertTestUser({ name: "Alice" });
    await insertTestAccount({ id: "alice-bank", userId: alice, type: "BANK", balance: 1000 });
    await insertTestInvestment({ id: "alice-cdb", userId: alice, balance: 5000 });

    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() + 1);
    const goalId = await createGoal({
      name: "Emergency fund",
      targetAmount: 7000,
      targetDate: targetDate.toISOString().slice(0, 10),
      userId: alice,
    });

    const [goal] = await listGoals(alice);
    expect(goal!.id).toBe(goalId);
    // currentNetWorth = 1000 (bank) + 5000 (investments) = 6000, not 11000.
    expect(goal!.required_monthly_savings).toBe(1000);
    // No bills/debts/card spend this month — projected growth is just one
    // month of interest on the 6000 starting balance. The old, double-
    // counted math would have put this over 5000 (an extra untaxed
    // investmentTotal added on top).
    expect(goal!.projected_monthly_savings).toBeGreaterThan(0);
    expect(goal!.projected_monthly_savings).toBeLessThan(200);
  });
});
