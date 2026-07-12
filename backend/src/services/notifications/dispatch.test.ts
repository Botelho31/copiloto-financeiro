import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../db";
import {
  categoryIdByName,
  insertTestAccount,
  insertTestTransaction,
  insertTestUser,
  resetDb,
} from "../../test/helpers";
import { evaluateAndDispatch } from "./dispatch";
import { largeTransactionRule, projectedShortfallRule } from "./rules";

beforeEach(() => resetDb());

function notificationCount(userId: number, ruleKey: string): number {
  return (
    db
      .query("SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND rule_key = ?")
      .get(userId, ruleKey) as { count: number }
  ).count;
}

describe("largeTransactionRule", () => {
  test("fires only for transactions at or above the threshold", () => {
    const userId = insertTestUser();
    const accountId = insertTestAccount({ id: "acct-1", userId });
    const bigTxId = insertTestTransaction({ accountId, userId, date: "2026-01-01", amount: -600 });
    insertTestTransaction({ accountId, userId, date: "2026-01-02", amount: -10 });

    const drafts = largeTransactionRule.evaluate({
      userId,
      newTransactionIds: [bigTxId, "does-not-exist"],
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.dedupeKey).toBe(bigTxId);
  });

  test("ignores transactions not in newTransactionIds even if large", () => {
    const userId = insertTestUser();
    const accountId = insertTestAccount({ id: "acct-1", userId });
    insertTestTransaction({ accountId, userId, date: "2026-01-01", amount: -600 });

    expect(largeTransactionRule.evaluate({ userId, newTransactionIds: [] })).toHaveLength(0);
  });
});

describe("projectedShortfallRule", () => {
  test("fires when next month's projection is a shortfall, dedupes on the month label", () => {
    const userId = insertTestUser();
    insertTestAccount({ id: "acct-1", userId, type: "BANK", balance: -5000 });

    const drafts = projectedShortfallRule.evaluate({ userId, newTransactionIds: [] });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.dedupeKey).toMatch(/^\d{4}-\d{2}$/);
  });

  test("does not fire when the balance is healthy", () => {
    const userId = insertTestUser();
    insertTestAccount({ id: "acct-1", userId, type: "BANK", balance: 5000 });

    expect(projectedShortfallRule.evaluate({ userId, newTransactionIds: [] })).toHaveLength(0);
  });
});

describe("evaluateAndDispatch — dedup across repeated evaluation", () => {
  test("running the same sync context twice only creates one notification", async () => {
    const userId = insertTestUser();
    const accountId = insertTestAccount({ id: "acct-1", userId });
    const bigTxId = insertTestTransaction({
      accountId,
      userId,
      date: "2026-01-01",
      amount: -600,
      categoryId: categoryIdByName("Uncategorized"),
    });

    const firstRun = await evaluateAndDispatch({ userId, newTransactionIds: [bigTxId] });
    const secondRun = await evaluateAndDispatch({ userId, newTransactionIds: [bigTxId] });

    expect(firstRun).toBeGreaterThanOrEqual(1);
    expect(secondRun).toBe(0); // same event, already recorded — not a new notification
    expect(notificationCount(userId, "large_transaction")).toBe(1);
  });

  test("with no providers configured, dispatch still creates the notification (delivery is just a no-op)", async () => {
    const userId = insertTestUser();
    const accountId = insertTestAccount({ id: "acct-1", userId });
    const bigTxId = insertTestTransaction({ accountId, userId, date: "2026-01-01", amount: -1000 });

    const created = await evaluateAndDispatch({ userId, newTransactionIds: [bigTxId] });

    expect(created).toBeGreaterThanOrEqual(1);
    const deliveries = db.query("SELECT COUNT(*) as count FROM notification_deliveries").get() as {
      count: number;
    };
    expect(deliveries.count).toBe(0); // nothing to deliver through — no providers enabled
  });
});
