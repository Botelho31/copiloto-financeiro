import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb, insertTestAccount, insertTestTransaction, insertTestUser } from "../test/helpers";
import { createUser, deleteUser, listUsers, updateUser } from "./users";
import { getDb } from "../db";

beforeEach(async () => await resetDb());

describe("createUser", () => {
  test("creates a person with defaults", async () => {
    const users = await createUser({ name: "Alice" });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      name: "Alice",
      hasPluggyCredentials: false,
      pluggyItemIds: [],
    });
  });

  test("rejects a duplicate name", async () => {
    await createUser({ name: "Alice" });
    await expect(createUser({ name: "Alice" })).rejects.toThrow(/already exists/);
  });

  test("rejects a missing name", async () => {
    await expect(createUser({ name: "" })).rejects.toThrow(/name is required/);
  });

  test("splits pluggyItemIds and reports hasPluggyCredentials once a client id is set", async () => {
    const users = await createUser({
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
  test("leaves the secret unchanged when a blank one is sent", async () => {
    const id = await insertTestUser({
      pluggyClientId: "orig-id",
      pluggyClientSecret: "orig-secret",
    });
    await updateUser(id, { pluggyClientSecret: "" });
    const result = await getDb().execute({
      sql: "SELECT pluggy_client_secret FROM users WHERE id = ?",
      args: [id],
    });
    expect(result.rows[0]!.pluggy_client_secret).toBe("orig-secret");
  });

  test("overwrites the secret when a real value is sent", async () => {
    const id = await insertTestUser({ pluggyClientSecret: "orig-secret" });
    await updateUser(id, { pluggyClientSecret: "new-secret" });
    const result = await getDb().execute({
      sql: "SELECT pluggy_client_secret FROM users WHERE id = ?",
      args: [id],
    });
    expect(result.rows[0]!.pluggy_client_secret).toBe("new-secret");
  });

  test("throws for a nonexistent user", async () => {
    await expect(updateUser(999999, { name: "Nope" })).rejects.toThrow(/not found/);
  });
});

describe("deleteUser", () => {
  test("refuses to delete the last remaining person", async () => {
    const id = await insertTestUser();
    await expect(deleteUser(id)).rejects.toThrow(/last remaining person/);
    expect(await listUsers()).toHaveLength(1);
  });

  test("refuses to delete someone still shared_with_user_id on an active debt", async () => {
    const owner = await insertTestUser({ name: "Owner" });
    const other = await insertTestUser({ name: "Other" });
    await getDb().execute({
      sql: `INSERT INTO debts (name, direction, user_id, shared_with_user_id, principal_amount, start_date, status)
            VALUES ('Shared debt', 'owed_to_me', ?, ?, 1000, '2026-01-01', 'active')`,
      args: [owner, other],
    });

    await expect(deleteUser(other)).rejects.toThrow(/unlink this person/);
  });

  test("cascade-deletes accounts and transactions owned by the person", async () => {
    const keep = await insertTestUser({ name: "Keep" });
    const gone = await insertTestUser({ name: "Gone" });
    await insertTestAccount({ id: "acct-keep", userId: keep });
    await insertTestAccount({ id: "acct-gone", userId: gone });
    await insertTestTransaction({
      accountId: "acct-gone",
      userId: gone,
      date: "2026-01-01",
      amount: -50,
    });

    await deleteUser(gone);

    const goneAcct = await getDb().execute("SELECT id FROM accounts WHERE id = 'acct-gone'");
    const keepAcct = await getDb().execute("SELECT id FROM accounts WHERE id = 'acct-keep'");
    expect(goneAcct.rows[0]).toBeUndefined();
    expect(keepAcct.rows[0]).not.toBeUndefined();

    const txCount = await getDb().execute({
      sql: "SELECT COUNT(*) as n FROM transactions WHERE user_id = ?",
      args: [gone],
    });
    expect(txCount.rows[0]!.n).toBe(0);
  });
});
