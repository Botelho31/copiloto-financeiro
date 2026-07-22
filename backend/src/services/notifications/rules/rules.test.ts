import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../../db";
import {
  insertTestAccount,
  insertTestTransaction,
  insertTestUser,
  resetDb,
} from "../../../test/helpers";
import { largeTransactionRule } from "./largeTransaction";
import { projectedShortfallRule } from "./projectedShortfall";

// projectedShortfallRule always targets "next month" from the real clock —
// this is that label's own predecessor, i.e. the current real calendar
// month, matching the format in projectionEngine.ts.
function currentMonthLabel(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function insertTestNotification(userId: number, ruleKey: string, dedupeKey: string): void {
  db.query(
    `INSERT INTO notifications (user_id, rule_key, severity, title, body, dedupe_key)
     VALUES (?, ?, 'critical', 'test', 'test', ?)`
  ).run(userId, ruleKey, dedupeKey);
}

beforeEach(() => resetDb());

describe("largeTransactionRule", () => {
  test("fires only for transactions at or above the threshold", () => {
    const userId = insertTestUser();
    const accountId = insertTestAccount({ id: "acct-1", userId });
    const bigTxId = insertTestTransaction({ accountId, userId, date: "2026-01-01", amount: -600 });
    insertTestTransaction({ accountId, userId, date: "2026-01-02", amount: -10 });

    const drafts = largeTransactionRule.evaluate(
      { userId, newTransactionIds: [bigTxId, "does-not-exist"] },
      { largeTransactionThreshold: 500 }
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.dedupeKey).toBe(bigTxId);
  });

  test("ignores transactions not in newTransactionIds even if large", () => {
    const userId = insertTestUser();
    const accountId = insertTestAccount({ id: "acct-1", userId });
    insertTestTransaction({ accountId, userId, date: "2026-01-01", amount: -600 });

    expect(
      largeTransactionRule.evaluate(
        { userId, newTransactionIds: [] },
        { largeTransactionThreshold: 500 }
      )
    ).toHaveLength(0);
  });

  test("a custom threshold changes firing behavior", () => {
    const userId = insertTestUser();
    const accountId = insertTestAccount({ id: "acct-1", userId });
    const txId = insertTestTransaction({ accountId, userId, date: "2026-01-01", amount: -600 });

    expect(
      largeTransactionRule.evaluate(
        { userId, newTransactionIds: [txId] },
        { largeTransactionThreshold: 700 }
      )
    ).toHaveLength(0);
    expect(
      largeTransactionRule.evaluate(
        { userId, newTransactionIds: [txId] },
        { largeTransactionThreshold: 500 }
      )
    ).toHaveLength(1);
  });
});

describe("projectedShortfallRule", () => {
  test("fires (not silent) when next month's projection is a shortfall, dedupes on the month label", () => {
    const userId = insertTestUser();
    insertTestAccount({ id: "acct-1", userId, type: "BANK", balance: -5000 });

    const drafts = projectedShortfallRule.evaluate({ userId, newTransactionIds: [] }, {});
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.dedupeKey).toMatch(/^\d{4}-\d{2}$/);
    expect(drafts[0]!.silent).toBeFalsy();
  });

  test("does not fire when the balance is healthy", () => {
    const userId = insertTestUser();
    insertTestAccount({ id: "acct-1", userId, type: "BANK", balance: 5000 });

    expect(projectedShortfallRule.evaluate({ userId, newTransactionIds: [] }, {})).toHaveLength(0);
  });

  test("marks silent when the immediately preceding month was already notified (unresolved streak)", () => {
    const userId = insertTestUser();
    insertTestAccount({ id: "acct-1", userId, type: "BANK", balance: -5000 });
    insertTestNotification(userId, "projected_shortfall", currentMonthLabel());

    const drafts = projectedShortfallRule.evaluate({ userId, newTransactionIds: [] }, {});
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.silent).toBe(true);
  });

  test("does not mark silent when the preceding month was never notified (fresh onset)", () => {
    const userId = insertTestUser();
    insertTestAccount({ id: "acct-1", userId, type: "BANK", balance: -5000 });
    // A notification exists, but for some older month — not adjacent — so
    // this is a new onset (or a resumption after a healthy gap), not a
    // continuation of an unbroken streak.
    insertTestNotification(userId, "projected_shortfall", "2000-01");

    const drafts = projectedShortfallRule.evaluate({ userId, newTransactionIds: [] }, {});
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.silent).toBeFalsy();
  });

  test("does not leak another person's notification into this person's streak check", () => {
    const userId = insertTestUser();
    const otherUserId = insertTestUser();
    insertTestAccount({ id: "acct-1", userId, type: "BANK", balance: -5000 });
    insertTestNotification(otherUserId, "projected_shortfall", currentMonthLabel());

    const drafts = projectedShortfallRule.evaluate({ userId, newTransactionIds: [] }, {});
    expect(drafts[0]!.silent).toBeFalsy();
  });
});
