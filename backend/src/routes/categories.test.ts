import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../db";
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
  test("refuses to delete Uncategorized", () => {
    const id = categoryIdByName("Uncategorized");
    expect(() => deleteCategory(id)).toThrow(/can't be deleted/);
  });

  test("throws for a nonexistent category", () => {
    expect(() => deleteCategory(999999)).toThrow(/not found/);
  });

  test("reassigns its transactions to Uncategorized and drops its rules", () => {
    const categories = createCategory("Custom");
    const custom = categories.find((c) => c.name === "Custom")!;
    const userId = insertTestUser();
    const accountId = insertTestAccount({ id: "acc-1", userId });
    const txId = insertTestTransaction({
      accountId,
      userId,
      date: "2026-01-01",
      amount: -10,
      categoryId: custom.id,
    });
    db.query("INSERT INTO category_rules (match_text, category_id) VALUES (?, ?)").run(
      "custom rule",
      custom.id
    );

    deleteCategory(custom.id);

    const tx = db.query("SELECT category_id FROM transactions WHERE id = ?").get(txId) as {
      category_id: number;
    };
    expect(tx.category_id).toBe(categoryIdByName("Uncategorized"));
    expect(
      db.query("SELECT id FROM category_rules WHERE category_id = ?").get(custom.id)
    ).toBeNull();
    expect(db.query("SELECT id FROM categories WHERE id = ?").get(custom.id)).toBeNull();
  });
});
