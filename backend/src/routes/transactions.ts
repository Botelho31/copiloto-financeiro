import { Elysia } from "elysia";
import type { Transaction } from "shared";
import { db } from "../db";
import { normalizeDescription } from "../jobs/recurringDetection";

export const transactionsRoutes = new Elysia({ prefix: "/api/transactions" })
  .get("/earliest-date", () => {
    const row = db.query("SELECT MIN(date) as date FROM transactions").get() as {
      date: string | null;
    };
    return { date: row.date };
  })
  .get("/search", ({ query }) => {
    const q = (query.q as string | undefined)?.trim();
    if (!q) return [];
    // Deliberately spans all time, not the currently-selected period — this
    // is for fast ad-hoc categorization ("search for 'uber', label all of
    // them"), not for reviewing a specific month.
    return db
      .query(
        `SELECT t.id, t.account_id, t.date, t.description, t.amount, t.type, t.status, t.currency_code,
                t.category_id, c.name as category_name
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.description LIKE ?
         ORDER BY t.date DESC
         LIMIT 1000`
      )
      .all(`%${q}%`) as Transaction[];
  })
  .get("/", ({ query }) => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.from) {
      conditions.push("t.date >= ?");
      params.push(query.from);
    }
    if (query.to) {
      conditions.push("t.date < ?");
      params.push(query.to);
    }
    if (query.categoryId) {
      conditions.push("t.category_id = ?");
      params.push(Number(query.categoryId));
    }
    if (query.accountId) {
      conditions.push("t.account_id = ?");
      params.push(query.accountId);
    }
    if (query.tagId) {
      conditions.push(
        "t.id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id = ?)"
      );
      params.push(Number(query.tagId));
    }

    // Only cap unbounded queries — a date-ranged query (a month, quarter,
    // year...) should return everything in that range, not get silently
    // truncated.
    const isBounded = Boolean(query.from || query.to);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = isBounded ? "" : "LIMIT 500";
    return db
      .query(
        `SELECT t.id, t.account_id, t.date, t.description, t.amount, t.type, t.status, t.currency_code,
                t.category_id, c.name as category_name
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         ${where}
         ORDER BY t.date DESC
         ${limit}`
      )
      .all(...(params as [])) as Transaction[];
  })
  .patch("/:id", ({ params, body, set }) => {
    const input = body as { categoryId?: number; createRule?: boolean };
    if (!input.categoryId) {
      set.status = 400;
      return { error: "categoryId is required" };
    }

    const tx = db.query("SELECT description FROM transactions WHERE id = ?").get(params.id) as
      | { description: string }
      | null;
    if (!tx) {
      set.status = 404;
      return { error: "not found" };
    }

    db.query("UPDATE transactions SET category_id = ? WHERE id = ?").run(
      input.categoryId,
      params.id
    );

    if (input.createRule) {
      const matchText = normalizeDescription(tx.description);
      if (matchText) {
        const existing = db
          .query("SELECT id FROM category_rules WHERE match_text = ?")
          .get(matchText);
        if (!existing) {
          db.query("INSERT INTO category_rules (match_text, category_id) VALUES (?, ?)").run(
            matchText,
            input.categoryId
          );
        }
      }
    }

    return { ok: true };
  })
  .post("/bulk-categorize", ({ body, set }) => {
    const input = body as { transactionIds?: string[]; categoryId?: number };
    if (!input.transactionIds?.length || !input.categoryId) {
      set.status = 400;
      return { error: "transactionIds and categoryId are required" };
    }
    // Direct override, regardless of current category — unlike rule-based
    // categorization (which only ever touches "Uncategorized" rows), this
    // is for explicitly reclassifying a group the user picked in the UI.
    const placeholders = input.transactionIds.map(() => "?").join(",");
    db.query(`UPDATE transactions SET category_id = ? WHERE id IN (${placeholders})`).run(
      input.categoryId,
      ...input.transactionIds
    );
    return { updated: input.transactionIds.length };
  });
