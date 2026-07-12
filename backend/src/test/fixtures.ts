import { db } from "../db";
import { categoryIdByName } from "./helpers";

// A realistic two-person household, seeded once per test via seedHouseholdFixture()
// rather than each test hand-building a handful of ad-hoc rows. Meant for
// integration-style tests that exercise several resources together (Household
// aggregation, shared debts, category rollups) — the focused unit tests
// elsewhere still build their own minimal state with test/helpers.ts, which
// stays the right tool when a test only cares about one specific rule.
export interface HouseholdFixture {
  alice: { userId: number; bankAccountId: string; cardAccountId: string };
  bob: { userId: number; bankAccountId: string; cardAccountId: string };
  sharedDebtId: number;
  rentBillId: number;
}

export function seedHouseholdFixture(): HouseholdFixture {
  const income = categoryIdByName("Income");
  const groceries = categoryIdByName("Groceries");
  const housing = categoryIdByName("Housing");

  const aliceId = Number(
    db
      .query(
        `INSERT INTO users (name, color, pluggy_client_id, pluggy_item_ids)
         VALUES ('Alice', '#5f7fbf', 'alice-client', 'alice-item-1')`
      )
      .run().lastInsertRowid
  );
  const bobId = Number(
    db.query("INSERT INTO users (name, color) VALUES ('Bob', '#4c9a6a')").run().lastInsertRowid
  );

  db.query("INSERT INTO items (id, user_id, status) VALUES ('alice-item-1', ?, 'active')").run(
    aliceId
  );
  db.query("INSERT INTO items (id, user_id, status) VALUES ('bob-item-1', ?, 'active')").run(bobId);

  const aliceBank = "alice-bank";
  const aliceCard = "alice-card";
  const bobBank = "bob-bank";
  const bobCard = "bob-card";
  db.query(
    "INSERT INTO accounts (id, item_id, user_id, name, type, subtype, balance) VALUES (?, 'alice-item-1', ?, 'Alice Checking', 'BANK', 'checking', 5000)"
  ).run(aliceBank, aliceId);
  db.query(
    "INSERT INTO accounts (id, item_id, user_id, name, type, subtype, balance) VALUES (?, 'alice-item-1', ?, 'Alice Card', 'CREDIT', 'credit_card', 800)"
  ).run(aliceCard, aliceId);
  db.query(
    "INSERT INTO accounts (id, item_id, user_id, name, type, subtype, balance) VALUES (?, 'bob-item-1', ?, 'Bob Checking', 'BANK', 'checking', 3000)"
  ).run(bobBank, bobId);
  db.query(
    "INSERT INTO accounts (id, item_id, user_id, name, type, subtype, balance) VALUES (?, 'bob-item-1', ?, 'Bob Card', 'CREDIT', 'credit_card', 200)"
  ).run(bobCard, bobId);

  const tx = (
    id: string,
    accountId: string,
    userId: number,
    date: string,
    description: string,
    amount: number,
    categoryId: number
  ) => {
    db.query(
      `INSERT INTO transactions (id, account_id, user_id, date, description, amount, type, status, currency_code, category_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'POSTED', 'BRL', ?)`
    ).run(
      id,
      accountId,
      userId,
      date,
      description,
      amount,
      amount >= 0 ? "CREDIT" : "DEBIT",
      categoryId
    );
  };

  tx("alice-salary", aliceBank, aliceId, "2026-06-01", "Salary", 6000, income);
  tx("alice-groceries", aliceBank, aliceId, "2026-06-05", "Supermarket", -450, groceries);
  tx("alice-rent", aliceBank, aliceId, "2026-06-01", "Rent payment", -1800, housing);
  tx("bob-salary", bobBank, bobId, "2026-06-01", "Salary", 4000, income);
  tx("bob-groceries", bobBank, bobId, "2026-06-06", "Grocery run", -300, groceries);

  const rentBillId = Number(
    db
      .query(
        `INSERT INTO recurring_bills (name, user_id, category_id, expected_amount, cadence, source, confirmed, active)
         VALUES ('Rent', ?, ?, 1800, 'monthly', 'manual', 1, 1)`
      )
      .run(aliceId, housing).lastInsertRowid
  );

  // Alice fronted a shared expense; Bob owes 50% of it back — the same
  // split_percentage + shared_with_user_id mechanic ARCHITECTURE.md describes
  // for a real shared debt (e.g. "Juliana owes 20% of Estudio Foz").
  const sharedDebtId = Number(
    db
      .query(
        `INSERT INTO debts (name, direction, user_id, shared_with_user_id, principal_amount, start_date, status)
         VALUES ('Shared renovation cost', 'owed_to_me', ?, ?, 2000, '2026-01-01', 'active')`
      )
      .run(aliceId, bobId).lastInsertRowid
  );

  return {
    alice: { userId: aliceId, bankAccountId: aliceBank, cardAccountId: aliceCard },
    bob: { userId: bobId, bankAccountId: bobBank, cardAccountId: bobCard },
    sharedDebtId,
    rentBillId,
  };
}
