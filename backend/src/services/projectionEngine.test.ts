import { beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "../db";
import { updateSettings } from "../routes/settings";
import {
  categoryIdByName,
  insertTestAccount,
  insertTestInvestment,
  insertTestUser,
  resetDb,
} from "../test/helpers";
import { computeProjection, currentBalance } from "./projectionEngine";

beforeEach(async () => await resetDb());

async function insertBill(fields: {
  name: string;
  userId: number;
  categoryId?: number | null;
  expectedAmount: number;
  cadence?: string;
  debtId?: number | null;
}): Promise<number> {
  const result = await getDb().execute({
    sql: `INSERT INTO recurring_bills (name, user_id, category_id, expected_amount, cadence, debt_id, source, confirmed, active)
       VALUES (?, ?, ?, ?, ?, ?, 'manual', 1, 1)`,
    args: [
      fields.name,
      fields.userId,
      fields.categoryId ?? null,
      fields.expectedAmount,
      fields.cadence ?? "monthly",
      fields.debtId ?? null,
    ],
  });
  return Number(result.lastInsertRowid);
}

describe("currentBalance", () => {
  test("sums only BANK accounts, scoped by userId", async () => {
    const alice = await insertTestUser({ name: "Alice" });
    const bob = await insertTestUser({ name: "Bob" });
    await insertTestAccount({ id: "alice-bank", userId: alice, type: "BANK", balance: 1000 });
    await insertTestAccount({ id: "alice-card", userId: alice, type: "CREDIT", balance: 200 });
    await insertTestAccount({ id: "bob-bank", userId: bob, type: "BANK", balance: 500 });

    expect(await currentBalance(alice)).toBe(1000);
    expect(await currentBalance(null)).toBe(1500); // Household: both banks, no cards
  });
});

describe("computeProjection", () => {
  test("a confirmed expense bill nets negative and carries its category_name (R3)", async () => {
    const user = await insertTestUser({ name: "Alice" });
    await insertTestAccount({ id: "acct-1", userId: user, type: "BANK", balance: 0 });
    const groceries = await categoryIdByName("Groceries");
    await insertBill({
      name: "Groceries budget",
      userId: user,
      categoryId: groceries,
      expectedAmount: 300,
    });

    const result = await computeProjection({ userId: user, horizonMonths: 1 });
    const billLine = result.months[0]!.bills.find((b) => b.kind === "bill");
    expect(billLine).toBeDefined();
    expect(billLine!.amount).toBe(-300);
    expect(billLine!.category_name).toBe("Groceries");
  });

  test("an income-kind bill nets positive", async () => {
    const user = await insertTestUser({ name: "Alice" });
    await insertTestAccount({ id: "acct-1", userId: user, type: "BANK", balance: 0 });
    const income = await categoryIdByName("Income");
    await insertBill({ name: "Salary", userId: user, categoryId: income, expectedAmount: 5000 });

    const result = await computeProjection({ userId: user, horizonMonths: 1 });
    const billLine = result.months[0]!.bills.find((b) => b.kind === "bill");
    expect(billLine!.amount).toBe(5000);
  });

  test("Household (userId null) combines every person's starting balance", async () => {
    const alice = await insertTestUser({ name: "Alice" });
    const bob = await insertTestUser({ name: "Bob" });
    await insertTestAccount({ id: "alice-bank", userId: alice, type: "BANK", balance: 1000 });
    await insertTestAccount({ id: "bob-bank", userId: bob, type: "BANK", balance: 2000 });

    const result = await computeProjection({ userId: null, horizonMonths: 1 });
    expect(result.startingBalance).toBe(3000);
  });

  // Investments (e.g. CDBs) aren't BANK accounts, so currentBalance() alone
  // never sees them — but excluding them entirely from startingBalance made
  // the projected balance read as "wrong" next to money the person knows
  // they actually have. A withdrawn (non-ACTIVE) position no longer
  // represents real money, so it must not count.
  test("startingBalance folds in active investment holdings, excluding withdrawn ones", async () => {
    const alice = await insertTestUser({ name: "Alice" });
    await insertTestAccount({ id: "alice-bank", userId: alice, type: "BANK", balance: 1000 });
    await insertTestInvestment({
      id: "alice-cdb-1",
      userId: alice,
      balance: 5000,
      status: "ACTIVE",
    });
    await insertTestInvestment({
      id: "alice-cdb-2",
      userId: alice,
      balance: 2000,
      status: "ACTIVE",
    });
    await insertTestInvestment({
      id: "alice-cdb-withdrawn",
      userId: alice,
      balance: 0,
      status: "TOTAL_WITHDRAWAL",
    });

    const result = await computeProjection({ userId: alice, horizonMonths: 1 });
    expect(result.startingBalance).toBe(8000);
  });

  // getSettings(null) returns an aggregate of individual goals for display
  // (routes/settings.ts's householdCardSpendGoal) — that aggregate must not
  // leak into Household's own projection math as if it were a Household-
  // level goal, since that would silently override the discretionary-delta
  // average (a real regression this test guards against — see
  // routes/settings.ts and this file's own comment on cardSpendGoal).
  test("Household projections use the discretionary-scaled average, not a person's persisted card-spend goal", async () => {
    const alice = await insertTestUser({ name: "Alice" });
    await insertTestAccount({ id: "alice-bank", userId: alice, type: "BANK", balance: 0 });
    await insertTestAccount({ id: "alice-card", userId: alice, type: "CREDIT", balance: 0 });
    await updateSettings(alice, { cardSpendGoal: 1000 });

    // horizonMonths: 2 so month[1] (i=2) hits the baselineExpense branch —
    // month[0] (i=1) uses the real current card balance instead, which
    // isn't what this test is about.
    const household = await computeProjection({ userId: null, horizonMonths: 2 });
    const householdCardLine = household.months[1]!.bills.find((b) => b.kind === "cardSpend");
    // No real card transactions exist, so the 3-month average is 0 — with
    // no goal applying, cardExpenseThisMonth is 0 and no line is pushed at
    // all. Before the fix, Alice's persisted goal (1000, and she's the only
    // person, so it's also the household "sum") would have shown up here
    // as a "Credit card spending (goal)" line instead.
    expect(householdCardLine).toBeUndefined();

    // The same persisted goal must still apply for Alice's own projection —
    // this guards against overcorrecting and losing per-person goals too.
    const personal = await computeProjection({ userId: alice, horizonMonths: 2 });
    const personalCardLine = personal.months[1]!.bills.find((b) => b.kind === "cardSpend");
    expect(personalCardLine?.amount).toBe(-1000);
    expect(personalCardLine?.name).toBe("Credit card spending (goal)");
  });
});
