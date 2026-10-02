import { Elysia } from "elysia";
import { z } from "zod";
import type { Transaction } from "shared";
import { getDb } from "../db";
import { normalizeDescription } from "../jobs/recurringDetection";
import { parseUserId } from "../lib/scope";
import { bulkSetCategory, reclassifyMatching } from "../services/categorization";

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

const BulkSetCategoryByNameBody = z.object({
  transactionIds: z.array(z.string()).min(1),
  categoryName: z.string().min(1),
});

const ReclassifyMatchingBody = z.object({
  matchText: z.string().min(1),
  categoryName: z.string().min(1),
});

export const transactionsRoutes = new Elysia({ prefix: "/api/transactions" })
  .get("/earliest-date", async ({ query }) => {
    const userId = parseUserId(query);
    const where = userId != null ? "WHERE user_id = ?" : "";
    const result = await getDb().execute({
      sql: `SELECT MIN(date) as date FROM transactions ${where}`,
      args: userId != null ? [userId] : [],
    });
    const row = result.rows[0] as unknown as { date: string | null };
    return { date: row.date };
  })
  .get("/search", async ({ query }) => {
    const q = (query.q as string | undefined)?.trim();
    if (!q) return [];
    const userId = parseUserId(query);
    const userCondition = userId != null ? "AND t.user_id = ?" : "";
    // Deliberately spans all time, not the currently-selected period — this
    // is for fast ad-hoc categorization ("search for 'uber', label all of
    // them"), not for reviewing a specific month.
    const result = await getDb().execute({
      sql: `SELECT t.id, t.account_id, t.date, t.description, t.amount, t.type, t.status, t.currency_code,
                   t.category_id, c.name as category_name
            FROM transactions t
            LEFT JOIN categories c ON c.id = t.category_id
            WHERE t.description LIKE ? ${userCondition}
            ORDER BY t.date DESC
            LIMIT ${TRANSACTIONS_SEARCH_LIMIT}`,
      args: userId != null ? [`%${q}%`, userId] : [`%${q}%`],
    });
    return result.rows as unknown as Transaction[];
  })
  .get("/", async ({ query }) => {
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
    // The remaining params only apply to the unpaginated branch below (MCP's
    // ad-hoc querying, not the frontend's paginated browse table) — by
    // category *name* instead of id, a raw description substring, and
    // "Uncategorized" as a named shortcut rather than looking its id up first.
    if (query.categoryName) {
      conditions.push("c.name = ?");
      params.push(query.categoryName as string);
    }
    if (query.uncategorizedOnly === "true") {
      conditions.push("c.name = 'Uncategorized'");
    }
    if (query.descriptionContains) {
      conditions.push("t.description LIKE ?");
      params.push(`%${query.descriptionContains}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const db = getDb();

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
      const countResult = await db.execute({
        sql: `SELECT COUNT(*) as count FROM transactions t LEFT JOIN categories c ON c.id = t.category_id ${where}`,
        args: params as [],
      });
      const total = (countResult.rows[0] as unknown as { count: number }).count;
      const itemsResult = await db.execute({
        sql: `SELECT t.id, t.account_id, t.date, t.description, t.amount, t.type, t.status, t.currency_code,
                     t.category_id, c.name as category_name
              FROM transactions t
              LEFT JOIN categories c ON c.id = t.category_id
              ${where}
              ORDER BY t.date DESC
              LIMIT ? OFFSET ?`,
        args: [...params, pageSize, (page - 1) * pageSize] as unknown as [],
      });
      const items = itemsResult.rows as unknown as Transaction[];
      return { items, total, page, pageSize };
    }

    // Only cap unbounded queries — a date-ranged query (a month, quarter,
    // year...) should return everything in that range, not get silently
    // truncated. An explicit `limit` (MCP's ad-hoc querying) overrides the
    // default cap; a descriptionRegex (applied in JS, after SQL, since
    // SQLite has no native regex) must not be truncated by SQL first, or
    // rows the regex would have matched never get the chance to.
    const isBounded = Boolean(query.from || query.to);
    const explicitLimit = query.limit ? Number(query.limit) : undefined;
    const sqlLimit = query.descriptionRegex
      ? undefined
      : (explicitLimit ?? (isBounded ? undefined : UNBOUNDED_TRANSACTIONS_CAP));
    const result = await db.execute({
      sql: `SELECT t.id, t.account_id, t.date, t.description, t.amount, t.type, t.status, t.currency_code,
                   t.category_id, c.name as category_name
            FROM transactions t
            LEFT JOIN categories c ON c.id = t.category_id
            ${where}
            ORDER BY t.date DESC
            ${sqlLimit ? `LIMIT ${sqlLimit}` : ""}`,
      args: params as [],
    });
    let rows = result.rows as unknown as Transaction[];
    if (query.descriptionRegex) {
      const re = new RegExp(query.descriptionRegex as string, "i");
      rows = rows.filter((t) => re.test(t.description)).slice(0, explicitLimit ?? 200);
    }
    return rows;
  })
  .patch(
    "/:id",
    async ({ params, body, set }) => {
      const db = getDb();
      const txResult = await db.execute({
        sql: "SELECT description FROM transactions WHERE id = ?",
        args: [params.id],
      });
      const tx = txResult.rows[0] as unknown as { description: string } | undefined;
      if (!tx) {
        set.status = 404;
        return { error: "not found" };
      }

      // Both writes (the recategorization itself, and the optional new rule)
      // as one unit — a failure between them shouldn't leave a rule created
      // without the transaction that prompted it actually being recategorized.
      const dbTx = await db.transaction();
      try {
        await dbTx.execute({
          sql: "UPDATE transactions SET category_id = ? WHERE id = ?",
          args: [body.categoryId, params.id],
        });

        if (body.createRule) {
          const matchText = normalizeDescription(tx.description);
          if (matchText) {
            const existingResult = await dbTx.execute({
              sql: "SELECT id FROM category_rules WHERE match_text = ?",
              args: [matchText],
            });
            if (existingResult.rows.length === 0) {
              await dbTx.execute({
                sql: "INSERT INTO category_rules (match_text, category_id) VALUES (?, ?)",
                args: [matchText, body.categoryId],
              });
            }
          }
        }
        await dbTx.commit();
      } catch (err) {
        await dbTx.rollback();
        throw err;
      }

      return { ok: true };
    },
    { body: UpdateTransactionCategoryBody }
  )
  .post(
    "/bulk-categorize",
    async ({ body }) => {
      // Direct override, regardless of current category — unlike rule-based
      // categorization (which only ever touches "Uncategorized" rows), this
      // is for explicitly reclassifying a group the user picked in the UI.
      const placeholders = body.transactionIds.map(() => "?").join(",");
      await getDb().execute({
        sql: `UPDATE transactions SET category_id = ? WHERE id IN (${placeholders})`,
        args: [body.categoryId, ...body.transactionIds],
      });
      return { updated: body.transactionIds.length };
    },
    { body: BulkCategorizeBody }
  )
  // By category *name* and reusing services/categorization.ts directly —
  // distinct from /bulk-categorize above (by id, inline SQL, with an
  // optional rule) since this exists mainly for MCP callers that only have
  // a category's name on hand, not its id.
  .post(
    "/bulk-set-category",
    async ({ body }) => ({
      updated: await bulkSetCategory(body.transactionIds, body.categoryName),
    }),
    { body: BulkSetCategoryByNameBody }
  )
  .post("/reclassify", async ({ body }) => reclassifyMatching(body.matchText, body.categoryName), {
    body: ReclassifyMatchingBody,
  });
