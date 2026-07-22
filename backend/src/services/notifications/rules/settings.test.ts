import { beforeEach, describe, expect, test } from "bun:test";
import { insertTestUser, resetDb } from "../../../test/helpers";
import { largeTransactionRule } from "./largeTransaction";
import { projectedShortfallRule } from "./projectedShortfall";
import {
  deleteRuleRow,
  getAllResolvedRuleSettings,
  getResolvedRuleSettings,
  getRuleRow,
  listRuleRows,
  upsertRuleSettings,
} from "./settings";

beforeEach(() => resetDb());

describe("getRuleRow", () => {
  test("null when nothing has ever been saved for that exact scope", () => {
    const userId = insertTestUser();
    expect(getRuleRow("large_transaction", null)).toBeNull();
    expect(getRuleRow("large_transaction", userId)).toBeNull();
  });
});

describe("getResolvedRuleSettings", () => {
  test("falls back to schema defaults when neither a person row nor a household row exists", () => {
    const userId = insertTestUser();
    expect(getResolvedRuleSettings(largeTransactionRule, userId)).toEqual({
      enabled: true,
      metadata: { largeTransactionThreshold: 500 },
    });
    expect(getResolvedRuleSettings(projectedShortfallRule, userId)).toEqual({
      enabled: true,
      metadata: {},
    });
  });

  test("falls back to the household row when the person has no override", () => {
    const userId = insertTestUser();
    upsertRuleSettings("large_transaction", null, { metadata: { largeTransactionThreshold: 900 } });
    expect(getResolvedRuleSettings(largeTransactionRule, userId)).toEqual({
      enabled: true,
      metadata: { largeTransactionThreshold: 900 },
    });
  });

  test("a person's own row wins over the household default", () => {
    const userId = insertTestUser();
    upsertRuleSettings("large_transaction", null, { metadata: { largeTransactionThreshold: 900 } });
    upsertRuleSettings("large_transaction", userId, {
      metadata: { largeTransactionThreshold: 100 },
    });
    expect(getResolvedRuleSettings(largeTransactionRule, userId)).toEqual({
      enabled: true,
      metadata: { largeTransactionThreshold: 100 },
    });
  });

  test("does not leak one person's override onto another person", () => {
    const alice = insertTestUser();
    const bob = insertTestUser();
    upsertRuleSettings("large_transaction", alice, { enabled: false });
    expect(getResolvedRuleSettings(largeTransactionRule, bob)).toEqual({
      enabled: true,
      metadata: { largeTransactionThreshold: 500 },
    });
  });
});

describe("getAllResolvedRuleSettings", () => {
  test("returns every registered rule, resolved for one person, even with no rows", () => {
    const userId = insertTestUser();
    const all = getAllResolvedRuleSettings(userId);
    expect(all.size).toBe(2);
    expect(all.get("large_transaction")).toEqual({
      enabled: true,
      metadata: { largeTransactionThreshold: 500 },
    });
  });
});

describe("listRuleRows", () => {
  test("returns only rows that actually exist, household and per-person alike", () => {
    const userId = insertTestUser();
    expect(listRuleRows()).toEqual([]);

    upsertRuleSettings("large_transaction", null, {});
    upsertRuleSettings("large_transaction", userId, { enabled: false });

    const rows = listRuleRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.userId).sort()).toEqual([null, userId].sort());
  });
});

describe("upsertRuleSettings", () => {
  test("persists a partial update and round-trips through getAllResolvedRuleSettings", () => {
    const userId = insertTestUser();
    upsertRuleSettings("large_transaction", userId, { enabled: false });
    expect(getAllResolvedRuleSettings(userId).get("large_transaction")).toEqual({
      enabled: false,
      metadata: { largeTransactionThreshold: 500 },
    });
  });

  test("a metadata update merges onto the existing row rather than replacing it", () => {
    const userId = insertTestUser();
    upsertRuleSettings("large_transaction", userId, {
      metadata: { largeTransactionThreshold: 900 },
    });
    const result = upsertRuleSettings("large_transaction", userId, { enabled: false });
    expect(result).toEqual({
      key: "large_transaction",
      userId,
      enabled: false,
      metadata: { largeTransactionThreshold: 900 },
    });
  });

  test("creating a brand-new person override seeds from the current resolved value, not schema defaults", () => {
    const userId = insertTestUser();
    upsertRuleSettings("large_transaction", null, { metadata: { largeTransactionThreshold: 900 } });
    // Only touches `enabled` — the threshold should still come from the
    // household row it was just inheriting, not reset to 500.
    const result = upsertRuleSettings("large_transaction", userId, { enabled: false });
    expect(result).toEqual({
      key: "large_transaction",
      userId,
      enabled: false,
      metadata: { largeTransactionThreshold: 900 },
    });
  });

  test("rejects metadata that fails the rule's own schema", () => {
    const userId = insertTestUser();
    expect(() =>
      upsertRuleSettings("large_transaction", userId, {
        metadata: { largeTransactionThreshold: -5 },
      })
    ).toThrow();
  });

  test("throws for an unknown rule key", () => {
    expect(() => upsertRuleSettings("not_a_real_rule", null, { enabled: false })).toThrow();
  });
});

describe("deleteRuleRow", () => {
  test("removing a person's override falls back to the household default", () => {
    const userId = insertTestUser();
    upsertRuleSettings("large_transaction", null, { metadata: { largeTransactionThreshold: 900 } });
    upsertRuleSettings("large_transaction", userId, {
      metadata: { largeTransactionThreshold: 100 },
    });

    deleteRuleRow("large_transaction", userId);

    expect(getRuleRow("large_transaction", userId)).toBeNull();
    expect(getResolvedRuleSettings(largeTransactionRule, userId)).toEqual({
      enabled: true,
      metadata: { largeTransactionThreshold: 900 },
    });
  });

  test("removing the household row falls back to schema defaults", () => {
    const userId = insertTestUser();
    upsertRuleSettings("large_transaction", null, { metadata: { largeTransactionThreshold: 900 } });

    deleteRuleRow("large_transaction", null);

    expect(getResolvedRuleSettings(largeTransactionRule, userId)).toEqual({
      enabled: true,
      metadata: { largeTransactionThreshold: 500 },
    });
  });
});
