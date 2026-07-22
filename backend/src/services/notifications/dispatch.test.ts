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
import { upsertRuleSettings } from "./rules";

beforeEach(() => resetDb());

function notificationCount(userId: number, ruleKey: string): number {
  return (
    db
      .query("SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND rule_key = ?")
      .get(userId, ruleKey) as { count: number }
  ).count;
}

describe("evaluateAndDispatch — disabled rules", () => {
  test("a person-level disable never fires, even when its condition is met", async () => {
    const userId = insertTestUser();
    const accountId = insertTestAccount({ id: "acct-1", userId });
    const bigTxId = insertTestTransaction({ accountId, userId, date: "2026-01-01", amount: -1000 });

    upsertRuleSettings("large_transaction", userId, { enabled: false });
    const created = await evaluateAndDispatch({ userId, newTransactionIds: [bigTxId] });

    expect(created).toBe(0);
    expect(notificationCount(userId, "large_transaction")).toBe(0);
  });

  test("a household-level disable also stops it for a person with no override of their own", async () => {
    const userId = insertTestUser();
    const accountId = insertTestAccount({ id: "acct-1", userId });
    const bigTxId = insertTestTransaction({ accountId, userId, date: "2026-01-01", amount: -1000 });

    upsertRuleSettings("large_transaction", null, { enabled: false });
    const created = await evaluateAndDispatch({ userId, newTransactionIds: [bigTxId] });

    expect(created).toBe(0);
    expect(notificationCount(userId, "large_transaction")).toBe(0);
  });

  test("a person's own override wins over a household-level disable", async () => {
    const userId = insertTestUser();
    const accountId = insertTestAccount({ id: "acct-1", userId });
    const bigTxId = insertTestTransaction({ accountId, userId, date: "2026-01-01", amount: -1000 });

    upsertRuleSettings("large_transaction", null, { enabled: false });
    upsertRuleSettings("large_transaction", userId, { enabled: true });
    const created = await evaluateAndDispatch({ userId, newTransactionIds: [bigTxId] });

    expect(created).toBe(1);
    expect(notificationCount(userId, "large_transaction")).toBe(1);
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

describe("evaluateAndDispatch — silent drafts", () => {
  test("a silent draft is recorded (counts as created) but never delivered, even with a provider configured", async () => {
    const userId = insertTestUser();
    insertTestAccount({ id: "acct-1", userId, type: "BANK", balance: -5000 });
    db.query(
      `INSERT INTO notification_providers (user_id, provider, config, enabled)
       VALUES (?, 'pushover', '{"userKey":"fake"}', 1)`
    ).run(userId);
    // Seed a notification for the immediately preceding month so
    // projectedShortfallRule treats this month as an unresolved streak
    // continuation, i.e. silent (see rules/projectedShortfall.ts).
    const now = new Date();
    const currentMonthLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    db.query(
      `INSERT INTO notifications (user_id, rule_key, severity, title, body, dedupe_key)
       VALUES (?, 'projected_shortfall', 'critical', 't', 'b', ?)`
    ).run(userId, currentMonthLabel);

    const created = await evaluateAndDispatch({ userId, newTransactionIds: [] });

    expect(created).toBeGreaterThanOrEqual(1);
    expect(notificationCount(userId, "projected_shortfall")).toBe(2); // seeded row + this month's silent one
    const deliveries = db
      .query(
        `SELECT COUNT(*) as count FROM notification_deliveries nd
         JOIN notifications n ON n.id = nd.notification_id
         WHERE n.rule_key = 'projected_shortfall'`
      )
      .get() as { count: number };
    expect(deliveries.count).toBe(0); // silent — delivery was never attempted
  });
});
