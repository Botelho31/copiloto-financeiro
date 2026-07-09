import { Elysia } from "elysia";
import type { Category, CategoryRule, UncategorizedGroup } from "shared";
import { db } from "../db";
import { normalizeDescription } from "../jobs/recurringDetection";

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

export function getUncategorizedGroups(days: number): UncategorizedGroup[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = db
    .query(
      `SELECT t.description, t.amount
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE c.name = 'Uncategorized' AND t.date >= ?`
    )
    .all(since) as { description: string; amount: number }[];

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

  return [...groups.values()].sort(
    (a, b) => b.count - a.count || b.totalAmount - a.totalAmount
  );
}

export function listRules(): CategoryRule[] {
  return db
    .query(
      `SELECT r.id, r.match_text, r.category_id, c.name as category_name
       FROM category_rules r
       JOIN categories c ON c.id = r.category_id
       ORDER BY r.match_text`
    )
    .all() as CategoryRule[];
}

export function listCategories(): Category[] {
  const rows = db
    .query(
      "SELECT id, name, kind, parent_id, excludes_from_cashflow, color FROM categories ORDER BY name"
    )
    .all() as (Omit<Category, "excludes_from_cashflow"> & { excludes_from_cashflow: number })[];
  return rows.map((r) => ({ ...r, excludes_from_cashflow: r.excludes_from_cashflow === 1 })) as Category[];
}

export function createCategory(name: string, kind?: string, color?: string): Category[] {
  const existing = db.query("SELECT id FROM categories WHERE name = ?").get(name);
  if (existing) throw new Error(`Category "${name}" already exists`);
  const count = (db.query("SELECT COUNT(*) as n FROM categories").get() as { n: number }).n;
  const resolvedColor = color ?? AUTO_PALETTE[count % AUTO_PALETTE.length];
  db.query("INSERT INTO categories (name, kind, color) VALUES (?, ?, ?)").run(
    name,
    kind === "income" ? "income" : "expense",
    resolvedColor
  );
  return listCategories();
}

export const categoriesRoutes = new Elysia({ prefix: "/api/categories" })
  .get("/", () => listCategories())
  .post("/", ({ body, set }) => {
    const input = body as { name?: string; kind?: string; color?: string };
    if (!input.name) {
      set.status = 400;
      return { error: "name is required" };
    }
    try {
      return createCategory(input.name, input.kind, input.color);
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? error.message : String(error) };
    }
  })
  .patch("/:id", ({ params, body, set }) => {
    const id = Number(params.id);
    const existing = db.query("SELECT id FROM categories WHERE id = ?").get(id);
    if (!existing) {
      set.status = 404;
      return { error: "not found" };
    }

    const input = body as Partial<{ name: string; color: string; excludesFromCashflow: boolean }>;
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
      db.query(`UPDATE categories SET ${fields.join(", ")} WHERE id = ?`).run(...(values as []));
    }
    return listCategories();
  })
  .get("/rules", () => listRules())
  .get("/uncategorized-groups", ({ query }) => {
    const days = query.days ? Number(query.days) : DEFAULT_LOOKBACK_DAYS;
    return getUncategorizedGroups(days);
  })
  .post("/bulk-assign", ({ body, set }) => {
    const input = body as { key?: string; categoryId?: number };
    if (!input.key || !input.categoryId) {
      set.status = 400;
      return { error: "key and categoryId are required" };
    }
    const normalizedKey = normalizeDescription(input.key);
    if (!normalizedKey) {
      set.status = 400;
      return { error: "key does not normalize to a usable match pattern" };
    }

    const existingRule = db
      .query("SELECT id FROM category_rules WHERE match_text = ?")
      .get(normalizedKey) as { id: number } | null;
    if (existingRule) {
      db.query("UPDATE category_rules SET category_id = ? WHERE id = ?").run(
        input.categoryId,
        existingRule.id
      );
    } else {
      db.query("INSERT INTO category_rules (match_text, category_id) VALUES (?, ?)").run(
        normalizedKey,
        input.categoryId
      );
    }

    const uncategorized = db
      .query(
        `SELECT t.id, t.description
         FROM transactions t
         JOIN categories c ON c.id = t.category_id
         WHERE c.name = 'Uncategorized'`
      )
      .all() as { id: string; description: string }[];

    let updated = 0;
    for (const tx of uncategorized) {
      if (normalizeDescription(tx.description) === normalizedKey) {
        db.query("UPDATE transactions SET category_id = ? WHERE id = ?").run(
          input.categoryId,
          tx.id
        );
        updated += 1;
      }
    }

    return { updated };
  })
  .post("/rules", ({ body, set }) => {
    const input = body as { matchText?: string; categoryId?: number };
    if (!input.matchText || !input.categoryId) {
      set.status = 400;
      return { error: "matchText and categoryId are required" };
    }
    db.query("INSERT INTO category_rules (match_text, category_id) VALUES (?, ?)").run(
      input.matchText.toLowerCase().trim(),
      input.categoryId
    );
    return listRules();
  })
  .delete("/rules/:id", ({ params }) => {
    db.query("DELETE FROM category_rules WHERE id = ?").run(Number(params.id));
    return listRules();
  });
