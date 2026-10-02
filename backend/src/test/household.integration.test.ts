import { beforeEach, describe, expect, test } from "bun:test";
import { listAccounts } from "../routes/accounts";
import { billsRoutes } from "../routes/bills";
import { listDebts } from "../services/debts";
import { computeProjection, currentBalance } from "../services/projectionEngine";
import { resetDb } from "./helpers";
import { seedHouseholdFixture, type HouseholdFixture } from "./fixtures";

describe("household fixture — cross-resource integration", () => {
  let fixture: HouseholdFixture;

  beforeEach(async () => {
    await resetDb();
    fixture = await seedHouseholdFixture();
  });

  test("Household (userId null) combines every person's accounts and balance", async () => {
    const accounts = await listAccounts(null);
    expect(accounts).toHaveLength(4);
    expect(await currentBalance(null)).toBe(8000); // Alice 5000 + Bob 3000 BANK accounts only

    const aliceOnly = await listAccounts(fixture.alice.userId);
    expect(aliceOnly).toHaveLength(2);
  });

  test("a shared debt is visible to both parties and counted once in Household", async () => {
    const householdDebts = await listDebts(null);
    expect(householdDebts).toHaveLength(1);

    const aliceView = (await listDebts(fixture.alice.userId)).find(
      (d) => d.id === fixture.sharedDebtId
    );
    expect(aliceView?.is_owner).toBe(true);
    expect(aliceView?.principal).toBe(2000);

    const bobView = (await listDebts(fixture.bob.userId)).find(
      (d) => d.id === fixture.sharedDebtId
    );
    expect(bobView).not.toBeUndefined();
    expect(bobView?.is_owner).toBe(false);
  });

  test("a person's own projection starts from just their own balance", async () => {
    const aliceProjection = await computeProjection({
      userId: fixture.alice.userId,
      horizonMonths: 1,
    });
    expect(aliceProjection.startingBalance).toBe(5000);

    const householdProjection = await computeProjection({ userId: null, horizonMonths: 1 });
    expect(householdProjection.startingBalance).toBe(8000);
  });

  test("the confirmed Rent bill projects into Alice's own month, not Bob's", async () => {
    const aliceProjection = await computeProjection({
      userId: fixture.alice.userId,
      horizonMonths: 1,
    });
    const rentLine = aliceProjection.months[0]!.bills.find((b) => b.id === fixture.rentBillId);
    expect(rentLine?.amount).toBe(-1800);
    expect(rentLine?.category_name).toBe("Housing");

    const bobProjection = await computeProjection({ userId: fixture.bob.userId, horizonMonths: 1 });
    expect(bobProjection.months[0]!.bills.find((b) => b.id === fixture.rentBillId)).toBeUndefined();
  });

  // Proves Zod is actually wired at the HTTP boundary (not just a schema
  // that's never invoked) — a real fetch against a real Elysia instance,
  // rejected before createBill's own logic ever runs.
  test("POST /api/bills rejects a malformed request body before it reaches the handler", async () => {
    const app = billsRoutes.listen(0);
    const port = (app.server as { port: number }).port;
    try {
      const res = await fetch(`http://localhost:${port}/api/bills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Rent",
          userId: fixture.alice.userId,
          expectedAmount: "not-a-number", // wrong type on purpose
          cadence: "monthly",
        }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { on: string };
      expect(body.on).toBe("body");
    } finally {
      app.stop();
    }
  });

  test("POST /api/bills accepts a well-formed request and persists it", async () => {
    const app = billsRoutes.listen(0);
    const port = (app.server as { port: number }).port;
    try {
      const res = await fetch(`http://localhost:${port}/api/bills?userId=${fixture.alice.userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Internet",
          userId: fixture.alice.userId,
          expectedAmount: 150,
          cadence: "monthly",
        }),
      });
      expect(res.status).toBe(200);
      const bills = (await res.json()) as { name: string }[];
      expect(bills.some((b) => b.name === "Internet")).toBe(true);
    } finally {
      app.stop();
    }
  });
});
