import { Elysia } from "elysia";
import { z } from "zod";
import type { Transaction } from "shared";
import { db } from "../db";
import { normalizeDescription } from "../jobs/recurringDetection";
import { parseUserId } from "../lib/scope";

// Only the raw, browse-everything transactions table on the frontend
// (Transactions.tsx's ungrouped view) actually needs paging — every other
// caller (Dashboard's cash-flow totals, the projection engine, grouped/
// search views) needs the *whole* period's rows to compute a correct sum or
// count, so pagination here is opt-in via `page`: omitted, the endpoint
// keeps its existing bare-array response untouched.
const DEFAULT_TRANSACTIONS_PAGE_SIZE = 50;
const MAX_TRANSACTIONS_PAGE_SIZE = 200;
// Safety net for an unbounded (no date range) list request — the frontend
// never actually makes one, since every browsing view is period- or
// page-scoped, but a direct API/MCP caller could.
const UNBOUNDED_TRANSACTIONS_CAP = 500;
const TRANSACTIONS_SEARCH_LIMIT = 1000;

const UpdateTransactionCategoryBody = z.object({
  categoryId: z.number().int(),
  createRule: z.boolean().optional(),
});

const BulkCategorizeBody = z.object({
  transactionIds: z.array(z.string()).min(1),
  categoryId: z.number().int(),
});

export const transactionsRoutes = new Elysia({ prefix: "/api/transactions" })
  .get("/earliest-date", ({ query }) => {
    const userId = parseUserId(query);
    const where = userId != null ? "WHERE user_id = ?" : "";
    const row = db
      .query(`SELECT MIN(date) as date FROM transactions ${where}`)
      .get(...(userId != null ? [userId] : [])) as { date: string | null };
    return { date: row.date };
  })
  .get("/search", ({ query }) => {
    const q = (query.q as string | undefined)?.trim();
    if (!q) return [];
    const userId = parseUserId(query);
    const userCondition = userId != null ? "AND t.user_id = ?" : "";
    // Deliberately spans all time, not the currently-selected period — this
    // is for fast ad-hoc categorization ("search for 'uber', label all of
    // them"), not for reviewing a specific month.
    return db
      .query(
        `SELECT t.id, t.account_id, t.date, t.description, t.amount, t.type, t.status, t.currency_code,
                t.category_id, c.name as category_name
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.description LIKE ? ${userCondition}
         ORDER BY t.date DESC
         LIMIT ${TRANSACTIONS_SEARCH_LIMIT}`
      )
      .all(`%${q}%`, ...(userId != null ? [userId] : [])) as Transaction[];
  })
  .get("/", ({ query }) => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const userId = parseUserId(query);
    if (userId != null) {
      conditions.push("t.user_id = ?");
      params.push(userId);
    }
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
      conditions.push("t.id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id = ?)");
      params.push(Number(query.tagId));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Paging is opt-in via `page` — a raw browse-everything table (the only
    // caller that doesn't need every row in memory at once) asks for a page;
    // everything else (cash-flow totals, the projection engine, grouped
    // views that need accurate per-description counts across the whole
    // period) keeps getting the full, unpaginated result shape it always
    // has.
    if (query.page) {
      const page = Math.max(1, Number(query.page));
      const pageSize = Math.min(
        MAX_TRANSACTIONS_PAGE_SIZE,
        Math.max(1, Number(query.pageSize) || DEFAULT_TRANSACTIONS_PAGE_SIZE)
      );
      const total = (
        db
          .query(
            `SELECT COUNT(*) as count FROM transactions t LEFT JOIN categories c ON c.id = t.category_id ${where}`
          )
          .get(...(params as [])) as { count: number }
      ).count;
      const items = db
        .query(
          `SELECT t.id, t.account_id, t.date, t.description, t.amount, t.type, t.status, t.currency_code,
                  t.category_id, c.name as category_name
           FROM transactions t
           LEFT JOIN categories c ON c.id = t.category_id
           ${where}
           ORDER BY t.date DESC
           LIMIT ? OFFSET ?`
        )
        .all(...(params as []), pageSize, (page - 1) * pageSize) as Transaction[];
      return { items, total, page, pageSize };
    }

    // Only cap unbounded queries — a date-ranged query (a month, quarter,
    // year...) should return everything in that range, not get silently
    // truncated.
    const isBounded = Boolean(query.from || query.to);
    const limit = isBounded ? "" : `LIMIT ${UNBOUNDED_TRANSACTIONS_CAP}`;
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
  .patch(
    "/:id",
    ({ params, body, set }) => {
      const tx = db.query("SELECT description FROM transactions WHERE id = ?").get(params.id) as {
        description: string;
      } | null;
      if (!tx) {
        set.status = 404;
        return { error: "not found" };
      }

      db.query("UPDATE transactions SET category_id = ? WHERE id = ?").run(
        body.categoryId,
        params.id
      );

      if (body.createRule) {
        const matchText = normalizeDescription(tx.description);
        if (matchText) {
          const existing = db
            .query("SELECT id FROM category_rules WHERE match_text = ?")
            .get(matchText);
          if (!existing) {
            db.query("INSERT INTO category_rules (match_text, category_id) VALUES (?, ?)").run(
              matchText,
              body.categoryId
            );
          }
        }
      }

      return { ok: true };
    },
    { body: UpdateTransactionCategoryBody }
  )
  .post(
    "/bulk-categorize",
    ({ body }) => {
      // Direct override, regardless of current category — unlike rule-based
      // categorization (which only ever touches "Uncategorized" rows), this
      // is for explicitly reclassifying a group the user picked in the UI.
      const placeholders = body.transactionIds.map(() => "?").join(",");
      db.query(`UPDATE transactions SET category_id = ? WHERE id IN (${placeholders})`).run(
        body.categoryId,
        ...body.transactionIds
      );
      return { updated: body.transactionIds.length };
    },
    { body: BulkCategorizeBody }
  );
