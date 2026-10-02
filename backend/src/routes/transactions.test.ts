import { beforeEach, describe, expect, test } from "bun:test";
import { insertTestAccount, insertTestTransaction, insertTestUser, resetDb } from "../test/helpers";
import { transactionsRoutes } from "./transactions";
import type { PaginatedTransactions } from "shared";

beforeEach(async () => await resetDb());

// Real HTTP requests against a real Elysia instance — proves paging is
// actually wired at the route, not just present in the handler's dead code.
describe("GET /api/transactions — pagination", () => {
  test("page param returns a slice + accurate total, unpaged callers keep the bare-array shape", async () => {
    const userId = await insertTestUser();
    const accountId = await insertTestAccount({ id: "acct-1", userId });
    for (let i = 0; i < 12; i++) {
      await insertTestTransaction({
        accountId,
        userId,
        date: `2026-01-${String(i + 1).padStart(2, "0")}`,
        amount: -10 - i,
      });
    }

    const app = transactionsRoutes.listen(0);
    const port = (app.server as { port: number }).port;
    try {
      // Unpaged: still the plain array shape every existing caller expects.
      const bareRes = await fetch(`http://localhost:${port}/api/transactions?userId=${userId}`);
      const bareBody = (await bareRes.json()) as unknown[];
      expect(Array.isArray(bareBody)).toBe(true);
      expect(bareBody).toHaveLength(12);

      // Page 1 of 5.
      const page1Res = await fetch(
        `http://localhost:${port}/api/transactions?userId=${userId}&page=1&pageSize=5`
      );
      const page1 = (await page1Res.json()) as PaginatedTransactions;
      expect(page1.total).toBe(12);
      expect(page1.page).toBe(1);
      expect(page1.pageSize).toBe(5);
      expect(page1.items).toHaveLength(5);
      // ORDER BY date DESC — newest (2026-01-12) first.
      expect(page1.items[0]!.date).toBe("2026-01-12");

      // Page 3 (last, partial) — 12 rows / 5 per page = 2 full pages + 2 left over.
      const page3Res = await fetch(
        `http://localhost:${port}/api/transactions?userId=${userId}&page=3&pageSize=5`
      );
      const page3 = (await page3Res.json()) as PaginatedTransactions;
      expect(page3.items).toHaveLength(2);
      expect(page3.items[1]!.date).toBe("2026-01-01");

      // No overlap between pages.
      const page2Res = await fetch(
        `http://localhost:${port}/api/transactions?userId=${userId}&page=2&pageSize=5`
      );
      const page2 = (await page2Res.json()) as PaginatedTransactions;
      const allIds = new Set([...page1.items, ...page2.items, ...page3.items].map((t) => t.id));
      expect(allIds.size).toBe(12);
    } finally {
      app.stop();
    }
  });

  test("pageSize is capped, not trusted from the client", async () => {
    const userId = await insertTestUser();
    const accountId = await insertTestAccount({ id: "acct-1", userId });
    await insertTestTransaction({ accountId, userId, date: "2026-01-01", amount: -10 });

    const app = transactionsRoutes.listen(0);
    const port = (app.server as { port: number }).port;
    try {
      const res = await fetch(
        `http://localhost:${port}/api/transactions?userId=${userId}&page=1&pageSize=999999`
      );
      const body = (await res.json()) as PaginatedTransactions;
      expect(body.pageSize).toBeLessThanOrEqual(200);
    } finally {
      app.stop();
    }
  });
});
