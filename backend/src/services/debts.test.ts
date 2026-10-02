import { beforeEach, describe, expect, test } from "bun:test";
import { pricePayment } from "shared";
import { getDb } from "../db";
import { insertTestUser, resetDb } from "../test/helpers";
import { linkDebtToDebt, linkTransactionsToDebt, listDebts } from "./debts";

beforeEach(async () => await resetDb());

async function insertDebt(fields: {
  name: string;
  direction: "owed_by_me" | "owed_to_me";
  userId: number;
  sharedWithUserId?: number;
  principalAmount?: number;
  splitPercentage?: number;
  expectedTotalAmount?: number;
  startDate: string;
  targetPayoffDate?: string;
  interestRateMonthlyPercent?: number;
  loanType?: "price" | "sac";
}): Promise<number> {
  const result = await getDb().execute({
    sql: `INSERT INTO debts
         (name, direction, user_id, shared_with_user_id, principal_amount, split_percentage,
          expected_total_amount, start_date, target_payoff_date, interest_rate_monthly_percent, loan_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      fields.name,
      fields.direction,
      fields.userId,
      fields.sharedWithUserId ?? null,
      fields.principalAmount ?? null,
      fields.splitPercentage ?? null,
      fields.expectedTotalAmount ?? null,
      fields.startDate,
      fields.targetPayoffDate ?? null,
      fields.interestRateMonthlyPercent ?? null,
      fields.loanType ?? null,
    ],
  });
  return Number(result.lastInsertRowid);
}

async function insertPayoffTx(
  id: string,
  userId: number,
  date: string,
  amount: number
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: "INSERT INTO items (id, user_id, status) VALUES ('item-1', ?, 'active') ON CONFLICT(id) DO NOTHING",
    args: [userId],
  });
  await db.execute({
    sql: "INSERT INTO accounts (id, item_id, user_id, name, type, subtype, balance) VALUES ('acct-1', 'item-1', ?, 'Acct', 'BANK', 'checking', 0) ON CONFLICT(id) DO NOTHING",
    args: [userId],
  });
  const uncategorized = await db.execute("SELECT id FROM categories WHERE name = 'Uncategorized'");
  await db.execute({
    sql: `INSERT INTO transactions (id, account_id, user_id, date, description, amount, type, status, currency_code, category_id)
     VALUES (?, 'acct-1', ?, ?, 'Payment', ?, 'DEBIT', 'POSTED', 'BRL', ?)`,
    args: [id, userId, date, amount, uncategorized.rows[0]!.id],
  });
}

describe("computeDebt — split_percentage + debt_links", () => {
  test("a percentage-share debt derives its principal from a linked debt's principal", async () => {
    const me = await insertTestUser({ name: "Me" });
    const other = await insertTestUser({ name: "Other" });

    // The originating debt: a fixed R$10,000 expense, already started.
    const originDebtId = await insertDebt({
      name: "House repair",
      direction: "owed_by_me",
      userId: me,
      principalAmount: 10000,
      startDate: "2020-01-01",
    });

    // A debt tracking that Other owes 20% of it — split_percentage, no
    // principalAmount of its own, fed entirely via debt_links.
    const shareDebtId = await insertDebt({
      name: "Other's 20% share",
      direction: "owed_to_me",
      userId: me,
      sharedWithUserId: other,
      splitPercentage: 20,
      startDate: "2020-01-01",
    });
    await linkDebtToDebt(shareDebtId, originDebtId);

    const [shareDebt] = (await listDebts(me)).filter((d) => d.id === shareDebtId);
    expect(shareDebt!.principal).toBeCloseTo(2000, 5); // 20% of 10,000
    expect(shareDebt!.linked_debts).toHaveLength(1);
    expect(shareDebt!.linked_debts[0]).toMatchObject({
      id: originDebtId,
      principal: 10000,
      countsTowardOrigin: true,
    });
  });

  test("a linked child debt that hasn't started yet doesn't inflate the parent's origin sum", async () => {
    const me = await insertTestUser({ name: "Me" });
    const futureOriginId = await insertDebt({
      name: "Future mortgage",
      direction: "owed_by_me",
      userId: me,
      principalAmount: 1_000_000,
      startDate: "2099-01-01", // far future
    });
    const shareDebtId = await insertDebt({
      name: "Share of future mortgage",
      direction: "owed_to_me",
      userId: me,
      splitPercentage: 20,
      startDate: "2020-01-01",
    });
    await linkDebtToDebt(shareDebtId, futureOriginId);

    const [shareDebt] = (await listDebts(me)).filter((d) => d.id === shareDebtId);
    expect(shareDebt!.principal).toBe(0); // future debt's principal doesn't count yet
    expect(shareDebt!.linked_debts[0]!.countsTowardOrigin).toBe(false);
  });

  test("pay_off transactions reduce remaining and drive percent_complete", async () => {
    const me = await insertTestUser({ name: "Me" });
    const debtId = await insertDebt({
      name: "Simple loan",
      direction: "owed_by_me",
      userId: me,
      principalAmount: 2000,
      startDate: "2020-01-01",
    });
    await insertPayoffTx("pay-1", me, "2020-02-01", -500);
    await linkTransactionsToDebt(debtId, ["pay-1"], "pay_off");

    const [debt] = (await listDebts(me)).filter((d) => d.id === debtId);
    expect(debt!.total_paid).toBeCloseTo(500, 5);
    expect(debt!.remaining).toBeCloseTo(1500, 5);
    expect(debt!.percent_complete).toBeCloseTo(0.25, 5);
  });
});

describe("computeDebt — formal loan payment plan", () => {
  test("a rate + loan_type + target_payoff_date debt gets a 'loan' payment_plan matching the shared PRICE formula", async () => {
    const me = await insertTestUser({ name: "Me" });
    const debtId = await insertDebt({
      name: "Mortgage",
      direction: "owed_by_me",
      userId: me,
      principalAmount: 100000,
      startDate: "2026-01-01",
      targetPayoffDate: "2027-01-01", // 12 months
      interestRateMonthlyPercent: 1,
      loanType: "price",
    });

    const [debt] = (await listDebts(me)).filter((d) => d.id === debtId);
    expect(debt!.payment_plan.source).toBe("loan");
    if (debt!.payment_plan.source === "loan") {
      expect(debt!.payment_plan.monthly_amount).toBeCloseTo(pricePayment(100000, 1, 12), 5);
      expect(debt!.payment_plan.term_months).toBe(12);
    }
  });

  test("with no payment history, plan and finish date have no basis (source: none)", async () => {
    const me = await insertTestUser({ name: "Me" });
    const debtId = await insertDebt({
      name: "Informal IOU",
      direction: "owed_by_me",
      userId: me,
      principalAmount: 500,
      startDate: "2020-01-01",
    });

    const [debt] = (await listDebts(me)).filter((d) => d.id === debtId);
    expect(debt!.payment_plan.source).toBe("none");
    expect(debt!.projected_finish_date).toBeNull();
  });
});

describe("listDebts — user scoping (is_owner, shared_with_user_id)", () => {
  test("a shared debt shows up for both the owner and the shared-with person, tagged correctly", async () => {
    const owner = await insertTestUser({ name: "Owner" });
    const sharedWith = await insertTestUser({ name: "SharedWith" });
    const debtId = await insertDebt({
      name: "Shared debt",
      direction: "owed_to_me",
      userId: owner,
      sharedWithUserId: sharedWith,
      principalAmount: 1000,
      startDate: "2020-01-01",
    });

    const ownerView = (await listDebts(owner)).find((d) => d.id === debtId);
    expect(ownerView?.is_owner).toBe(true);

    const sharedView = (await listDebts(sharedWith)).find((d) => d.id === debtId);
    expect(sharedView).not.toBeUndefined();
    expect(sharedView?.is_owner).toBe(false);
  });

  test("a third person's scoped view never sees someone else's debt", async () => {
    const owner = await insertTestUser({ name: "Owner" });
    const stranger = await insertTestUser({ name: "Stranger" });
    await insertDebt({
      name: "Private debt",
      direction: "owed_by_me",
      userId: owner,
      principalAmount: 100,
      startDate: "2020-01-01",
    });

    expect(await listDebts(stranger)).toHaveLength(0);
  });

  test("Household view (null) counts a shared debt exactly once", async () => {
    const owner = await insertTestUser({ name: "Owner" });
    const sharedWith = await insertTestUser({ name: "SharedWith" });
    await insertDebt({
      name: "Shared debt",
      direction: "owed_to_me",
      userId: owner,
      sharedWithUserId: sharedWith,
      principalAmount: 1000,
      startDate: "2020-01-01",
    });

    expect(await listDebts(null)).toHaveLength(1);
  });
});
