import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../db";
import { categoryIdByName, insertTestAccount, insertTestUser, resetDb } from "../test/helpers";
import { computeProjection, currentBalance } from "./projectionEngine";

beforeEach(() => resetDb());

function insertBill(fields: {
  name: string;
  userId: number;
  categoryId?: number | null;
  expectedAmount: number;
  cadence?: string;
  debtId?: number | null;
}): number {
  const result = db
    .query(
      `INSERT INTO recurring_bills (name, user_id, category_id, expected_amount, cadence, debt_id, source, confirmed, active)
       VALUES (?, ?, ?, ?, ?, ?, 'manual', 1, 1)`
    )
    .run(
      fields.name,
      fields.userId,
      fields.categoryId ?? null,
      fields.expectedAmount,
      fields.cadence ?? "monthly",
      fields.debtId ?? null
    );
  return Number(result.lastInsertRowid);
}

describe("currentBalance", () => {
  test("sums only BANK accounts, scoped by userId", () => {
    const alice = insertTestUser({ name: "Alice" });
    const bob = insertTestUser({ name: "Bob" });
    insertTestAccount({ id: "alice-bank", userId: alice, type: "BANK", balance: 1000 });
    insertTestAccount({ id: "alice-card", userId: alice, type: "CREDIT", balance: 200 });
    insertTestAccount({ id: "bob-bank", userId: bob, type: "BANK", balance: 500 });

    expect(currentBalance(alice)).toBe(1000);
    expect(currentBalance(null)).toBe(1500); // Household: both banks, no cards
  });
});

describe("computeProjection", () => {
  test("a confirmed expense bill nets negative and carries its category_name (R3)", () => {
    const user = insertTestUser({ name: "Alice" });
    insertTestAccount({ id: "acct-1", userId: user, type: "BANK", balance: 0 });
    const groceries = categoryIdByName("Groceries");
    insertBill({
      name: "Groceries budget",
      userId: user,
      categoryId: groceries,
      expectedAmount: 300,
    });

    const result = computeProjection({ userId: user, horizonMonths: 1 });
    const billLine = result.months[0]!.bills.find((b) => b.kind === "bill");
    expect(billLine).toBeDefined();
    expect(billLine!.amount).toBe(-300);
    expect(billLine!.category_name).toBe("Groceries");
  });

  test("an income-kind bill nets positive", () => {
    const user = insertTestUser({ name: "Alice" });
    insertTestAccount({ id: "acct-1", userId: user, type: "BANK", balance: 0 });
    const income = categoryIdByName("Income");
    insertBill({ name: "Salary", userId: user, categoryId: income, expectedAmount: 5000 });

    const result = computeProjection({ userId: user, horizonMonths: 1 });
    const billLine = result.months[0]!.bills.find((b) => b.kind === "bill");
    expect(billLine!.amount).toBe(5000);
  });

  test("Household (userId null) combines every person's starting balance", () => {
    const alice = insertTestUser({ name: "Alice" });
    const bob = insertTestUser({ name: "Bob" });
    insertTestAccount({ id: "alice-bank", userId: alice, type: "BANK", balance: 1000 });
    insertTestAccount({ id: "bob-bank", userId: bob, type: "BANK", balance: 2000 });

    const result = computeProjection({ userId: null, horizonMonths: 1 });
    expect(result.startingBalance).toBe(3000);
  });
});
