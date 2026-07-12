import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb, insertTestAccount, insertTestTransaction, insertTestUser } from "../test/helpers";
import { createUser, deleteUser, listUsers, updateUser } from "./users";
import { db } from "../db";

beforeEach(() => resetDb());

describe("createUser", () => {
  test("creates a person with defaults", () => {
    const users = createUser({ name: "Alice" });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      name: "Alice",
      hasPluggyCredentials: false,
      pluggyItemIds: [],
    });
  });

  test("rejects a duplicate name", () => {
    createUser({ name: "Alice" });
    expect(() => createUser({ name: "Alice" })).toThrow(/already exists/);
  });

  test("rejects a missing name", () => {
    expect(() => createUser({ name: "" })).toThrow(/name is required/);
  });

  test("splits pluggyItemIds and reports hasPluggyCredentials once a client id is set", () => {
    const users = createUser({
      name: "Bob",
      pluggyClientId: "client-1",
      pluggyClientSecret: "secret-1",
      pluggyItemIds: "item-a, item-b ,item-c",
    });
    expect(users[0]).toMatchObject({
      hasPluggyCredentials: true,
      pluggyItemIds: ["item-a", "item-b", "item-c"],
    });
  });
});

describe("updateUser", () => {
  test("leaves the secret unchanged when a blank one is sent", () => {
    const id = insertTestUser({ pluggyClientId: "orig-id", pluggyClientSecret: "orig-secret" });
    updateUser(id, { pluggyClientSecret: "" });
    const row = db.query("SELECT pluggy_client_secret FROM users WHERE id = ?").get(id) as {
      pluggy_client_secret: string;
    };
    expect(row.pluggy_client_secret).toBe("orig-secret");
  });

  test("overwrites the secret when a real value is sent", () => {
    const id = insertTestUser({ pluggyClientSecret: "orig-secret" });
    updateUser(id, { pluggyClientSecret: "new-secret" });
    const row = db.query("SELECT pluggy_client_secret FROM users WHERE id = ?").get(id) as {
      pluggy_client_secret: string;
    };
    expect(row.pluggy_client_secret).toBe("new-secret");
  });

  test("throws for a nonexistent user", () => {
    expect(() => updateUser(999999, { name: "Nope" })).toThrow(/not found/);
  });
});

describe("deleteUser", () => {
  test("refuses to delete the last remaining person", () => {
    const id = insertTestUser();
    expect(() => deleteUser(id)).toThrow(/last remaining person/);
    expect(listUsers()).toHaveLength(1);
  });

  test("refuses to delete someone still shared_with_user_id on an active debt", () => {
    const owner = insertTestUser({ name: "Owner" });
    const other = insertTestUser({ name: "Other" });
    db.query(
      `INSERT INTO debts (name, direction, user_id, shared_with_user_id, principal_amount, start_date, status)
       VALUES ('Shared debt', 'owed_to_me', ?, ?, 1000, '2026-01-01', 'active')`
    ).run(owner, other);

    expect(() => deleteUser(other)).toThrow(/unlink this person/);
  });

  test("cascade-deletes accounts and transactions owned by the person", () => {
    const keep = insertTestUser({ name: "Keep" });
    const gone = insertTestUser({ name: "Gone" });
    insertTestAccount({ id: "acct-keep", userId: keep });
    insertTestAccount({ id: "acct-gone", userId: gone });
    insertTestTransaction({
      accountId: "acct-gone",
      userId: gone,
      date: "2026-01-01",
      amount: -50,
    });

    deleteUser(gone);

    expect(db.query("SELECT id FROM accounts WHERE id = 'acct-gone'").get()).toBeNull();
    expect(db.query("SELECT id FROM accounts WHERE id = 'acct-keep'").get()).not.toBeNull();
    expect(
      (
        db.query("SELECT COUNT(*) as n FROM transactions WHERE user_id = ?").get(gone) as {
          n: number;
        }
      ).n
    ).toBe(0);
  });
});
