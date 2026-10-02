import { Elysia } from "elysia";
import { z } from "zod";
import type { Category, CategoryRule, UncategorizedGroup } from "shared";
import { getDb } from "../db";
import { normalizeDescription } from "../jobs/recurringDetection";
import { parseUserId } from "../lib/scope";
import { applyCategoryRule } from "../services/categorization";

const DEFAULT_LOOKBACK_DAYS = 30;

// Cycled through when creating a category without an explicit color.
const AUTO_PALETTE = [
  "#4c9a6a",
  "#c98a3e",
  "#5c8b99",
  "#7a8471",
  "#5f7fbf",
  "#9c5b4a",
  "#8c6a9c",
  "#b8763f",
  "#a15c8c",
  "#4a9c8f",
  "#b5542d",
  "#c9a227",
  "#7d8ba3",
];

export async function getUncategorizedGroups(
  days: number,
  userId: number | null = null
): Promise<UncategorizedGroup[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const userCondition = userId != null ? "AND t.user_id = ?" : "";
  const result = await getDb().execute({
    sql: `SELECT t.description, t.amount
          FROM transactions t
          JOIN categories c ON c.id = t.category_id
          WHERE c.name = 'Uncategorized' AND t.date >= ? ${userCondition}`,
    args: userId != null ? [since, userId] : [since],
  });
  const rows = result.rows as unknown as { description: string; amount: number }[];

  const groups = new Map<string, UncategorizedGroup>();
  for (const row of rows) {
    const key = normalizeDescription(row.description);
    if (!key) continue;
    const group = groups.get(key) ?? {
      key,
      sampleDescription: row.description,
      count: 0,
      totalAmount: 0,
    };
    group.count += 1;
    group.totalAmount += Math.abs(row.amount);
    groups.set(key, group);
  }

  return [...groups.values()].sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount);
}

export async function listRules(): Promise<CategoryRule[]> {
  const result = await getDb().execute(
    `SELECT r.id, r.match_text, r.category_id, c.name as category_name
     FROM category_rules r
     JOIN categories c ON c.id = r.category_id
     ORDER BY r.match_text`
  );
  return result.rows as unknown as CategoryRule[];
}

interface CategoryRow {
  id: number;
  name: string;
  kind: string;
  parent_id: number | null;
  excludes_from_cashflow: number;
  is_investment_transfer: number;
  is_card_bill_payment: number;
  color: string;
}

export async function listCategories(): Promise<Category[]> {
  const result = await getDb().execute(
    `SELECT id, name, kind, parent_id, excludes_from_cashflow, is_investment_transfer, is_card_bill_payment, color
     FROM categories ORDER BY name`
  );
  const rows = result.rows as unknown as CategoryRow[];
  return rows.map((r) => ({
    ...r,
    excludes_from_cashflow: r.excludes_from_cashflow === 1,
    is_investment_transfer: r.is_investment_transfer === 1,
    is_card_bill_payment: r.is_card_bill_payment === 1,
  })) as Category[];
}

export async function createCategory(
  name: string,
  kind?: string,
  color?: string
): Promise<Category[]> {
  const db = getDb();
  const existingResult = await db.execute({
    sql: "SELECT id FROM categories WHERE name = ?",
    args: [name],
  });
  if (existingResult.rows.length > 0) throw new Error(`Category "${name}" already exists`);
  const countResult = await db.execute("SELECT COUNT(*) as n FROM categories");
  const count = (countResult.rows[0] as unknown as { n: number }).n;
  const resolvedColor = color ?? AUTO_PALETTE[count % AUTO_PALETTE.length];
  await db.execute({
    sql: "INSERT INTO categories (name, kind, color) VALUES (?, ?, ?)",
    args: [name, kind === "income" ? "income" : "expense", resolvedColor],
  });
  return listCategories();
}

export const CategoryUpdateBody = z.object({
  name: z.string().optional(),
  color: z.string().optional(),
  excludesFromCashflow: z.boolean().optional(),
});
export type CategoryUpdateInput = z.infer<typeof CategoryUpdateBody>;

// Shared by the REST route and the MCP update_category tool.
export async function updateCategory(id: number, input: CategoryUpdateInput): Promise<Category[]> {
  const db = getDb();
  const existingResult = await db.execute({
    sql: "SELECT id FROM categories WHERE id = ?",
    args: [id],
  });
  if (existingResult.rows.length === 0) {
    throw new Error(`Category ${id} not found`);
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    fields.push("name = ?");
    values.push(input.name);
  }
  if (input.color !== undefined) {
    fields.push("color = ?");
    values.push(input.color);
  }
  if (input.excludesFromCashflow !== undefined) {
    fields.push("excludes_from_cashflow = ?");
    values.push(input.excludesFromCashflow ? 1 : 0);
  }
  if (fields.length > 0) {
    values.push(id);
    await db.execute({
      sql: `UPDATE categories SET ${fields.join(", ")} WHERE id = ?`,
      args: values as [],
    });
  }
  return listCategories();
}

// "Uncategorized" is the fallback every sync/detection job reassigns onto
// (see categorization.ts, transferDetection.ts) — it can't be removed.
// Deleting any other category reassigns its transactions/bills onto
// Uncategorized and drops its rules/child links rather than blocking the
// delete, so removing a category from the taxonomy never leaves orphaned
// data. All five writes are one atomic unit — a failure partway would
// otherwise leave some transactions reassigned and others still pointing at
// a category that's about to vanish.
export async function deleteCategory(id: number): Promise<Category[]> {
  const db = getDb();
  const categoryResult = await db.execute({
    sql: "SELECT id, name FROM categories WHERE id = ?",
    args: [id],
  });
  const category = categoryResult.rows[0] as unknown as { id: number; name: string } | undefined;
  if (!category) throw new Error(`Category ${id} not found`);
  if (category.name === "Uncategorized") {
    throw new Error("the Uncategorized category can't be deleted");
  }

  const uncategorizedResult = await db.execute(
    "SELECT id FROM categories WHERE name = 'Uncategorized'"
  );
  const uncategorizedId = (uncategorizedResult.rows[0] as unknown as { id: number }).id;

  const tx = await db.transaction();
  try {
    await tx.execute({
      sql: "UPDATE transactions SET category_id = ? WHERE category_id = ?",
      args: [uncategorizedId, id],
    });
    await tx.execute({
      sql: "UPDATE recurring_bills SET category_id = ? WHERE category_id = ?",
      args: [uncategorizedId, id],
    });
    await tx.execute({
      sql: "UPDATE categories SET parent_id = NULL WHERE parent_id = ?",
      args: [id],
    });
    await tx.execute({ sql: "DELETE FROM category_rules WHERE category_id = ?", args: [id] });
    await tx.execute({ sql: "DELETE FROM categories WHERE id = ?", args: [id] });
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  return listCategories();
}

const NewCategoryBody = z.object({
  name: z.string().min(1),
  kind: z.string().optional(),
  color: z.string().optional(),
});

const BulkAssignBody = z.object({
  key: z.string().min(1),
  categoryId: z.number().int(),
});

const NewCategoryRuleBody = z.object({
  matchText: z.string().min(1),
  categoryId: z.number().int(),
});

const ApplyCategoryRuleBody = z.object({
  matchText: z.string().min(1),
  categoryName: z.string().min(1),
});

export const categoriesRoutes = new Elysia({ prefix: "/api/categories" })
  .get("/", () => listCategories())
  .post(
    "/",
    async ({ body, set }) => {
      try {
        return await createCategory(body.name, body.kind, body.color);
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: NewCategoryBody }
  )
  .patch(
    "/:id",
    async ({ params, body, set }) => {
      try {
        return await updateCategory(Number(params.id), body);
      } catch (error) {
        set.status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: CategoryUpdateBody }
  )
  .delete("/:id", async ({ params, set }) => {
    try {
      return await deleteCategory(Number(params.id));
    } catch (error) {
      set.status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
      return { error: error instanceof Error ? error.message : String(error) };
    }
  })
  .get("/rules", () => listRules())
  .get("/uncategorized-groups", ({ query }) => {
    const days = query.days ? Number(query.days) : DEFAULT_LOOKBACK_DAYS;
    return getUncategorizedGroups(days, parseUserId(query));
  })
  .post(
    "/bulk-assign",
    async ({ body, set }) => {
      const normalizedKey = normalizeDescription(body.key);
      if (!normalizedKey) {
        set.status = 400;
        return { error: "key does not normalize to a usable match pattern" };
      }

      const tx = await getDb().transaction();
      let updated = 0;
      try {
        const existingRuleResult = await tx.execute({
          sql: "SELECT id FROM category_rules WHERE match_text = ?",
          args: [normalizedKey],
        });
        const existingRule = existingRuleResult.rows[0] as unknown as { id: number } | undefined;
        if (existingRule) {
          await tx.execute({
            sql: "UPDATE category_rules SET category_id = ? WHERE id = ?",
            args: [body.categoryId, existingRule.id],
          });
        } else {
          await tx.execute({
            sql: "INSERT INTO category_rules (match_text, category_id) VALUES (?, ?)",
            args: [normalizedKey, body.categoryId],
          });
        }

        const uncategorizedResult = await tx.execute(
          `SELECT t.id, t.description
           FROM transactions t
           JOIN categories c ON c.id = t.category_id
           WHERE c.name = 'Uncategorized'`
        );
        const uncategorized = uncategorizedResult.rows as unknown as {
          id: string;
          description: string;
        }[];

        for (const txRow of uncategorized) {
          if (normalizeDescription(txRow.description) === normalizedKey) {
            await tx.execute({
              sql: "UPDATE transactions SET category_id = ? WHERE id = ?",
              args: [body.categoryId, txRow.id],
            });
            updated += 1;
          }
        }
        await tx.commit();
      } catch (err) {
        await tx.rollback();
        throw err;
      }

      return { updated };
    },
    { body: BulkAssignBody }
  )
  .post(
    "/rules",
    async ({ body }) => {
      await getDb().execute({
        sql: "INSERT INTO category_rules (match_text, category_id) VALUES (?, ?)",
        args: [body.matchText.toLowerCase().trim(), body.categoryId],
      });
      return listRules();
    },
    { body: NewCategoryRuleBody }
  )
  .delete("/rules/:id", async ({ params }) => {
    await getDb().execute({
      sql: "DELETE FROM category_rules WHERE id = ?",
      args: [Number(params.id)],
    });
    return listRules();
  })
  // By category *name*, reusing services/categorization.ts's applyCategoryRule
  // directly — distinct from /bulk-assign above (by category id, inline SQL,
  // single description key) since this is the one the add-category-rules
  // skill and other MCP callers use, matching every currently-Uncategorized
  // transaction whose description contains matchText, not just an exact key.
  .post(
    "/apply-rule",
    async ({ body, set }) => {
      try {
        return await applyCategoryRule(body.matchText, body.categoryName);
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: ApplyCategoryRuleBody }
  );
