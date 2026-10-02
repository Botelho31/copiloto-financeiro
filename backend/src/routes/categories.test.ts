import { beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "../db";
import {
  categoryIdByName,
  insertTestAccount,
  insertTestTransaction,
  insertTestUser,
  resetDb,
} from "../test/helpers";
import { createCategory, deleteCategory } from "./categories";

beforeEach(() => resetDb());

describe("deleteCategory", () => {
  test("refuses to delete Uncategorized", async () => {
    const id = await categoryIdByName("Uncategorized");
    await expect(deleteCategory(id)).rejects.toThrow(/can't be deleted/);
  });

  test("throws for a nonexistent category", async () => {
    await expect(deleteCategory(999999)).rejects.toThrow(/not found/);
  });

  test("reassigns its transactions to Uncategorized and drops its rules", async () => {
    const categories = await createCategory("Custom");
    const custom = categories.find((c) => c.name === "Custom")!;
    const userId = await insertTestUser();
    const accountId = await insertTestAccount({ id: "acc-1", userId });
    const txId = await insertTestTransaction({
      accountId,
      userId,
      date: "2026-01-01",
      amount: -10,
      categoryId: custom.id,
    });
    const db = getDb();
    await db.execute({
      sql: "INSERT INTO category_rules (match_text, category_id) VALUES (?, ?)",
      args: ["custom rule", custom.id],
    });

    await deleteCategory(custom.id);

    const txResult = await db.execute({
      sql: "SELECT category_id FROM transactions WHERE id = ?",
      args: [txId],
    });
    const tx = txResult.rows[0] as unknown as { category_id: number };
    expect(tx.category_id).toBe(await categoryIdByName("Uncategorized"));
    const ruleResult = await db.execute({
      sql: "SELECT id FROM category_rules WHERE category_id = ?",
      args: [custom.id],
    });
    expect(ruleResult.rows.length).toBe(0);
    const categoryResult = await db.execute({
      sql: "SELECT id FROM categories WHERE id = ?",
      args: [custom.id],
    });
    expect(categoryResult.rows.length).toBe(0);
  });
});
