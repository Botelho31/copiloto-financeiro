import { beforeEach, describe, expect, test } from "bun:test";
import { insertTestAccount, insertTestUser, resetDb } from "../test/helpers";
import { listAccounts } from "./accounts";

beforeEach(() => resetDb());

describe("listAccounts — user scoping", () => {
  test("null userId (Household) returns every person's accounts combined", () => {
    const alice = insertTestUser({ name: "Alice" });
    const bob = insertTestUser({ name: "Bob" });
    insertTestAccount({ id: "alice-acct", userId: alice });
    insertTestAccount({ id: "bob-acct", userId: bob });

    const all = listAccounts(null);
    expect(all.map((a) => a.id).sort()).toEqual(["alice-acct", "bob-acct"]);
  });

  test("a specific userId only returns that person's accounts", () => {
    const alice = insertTestUser({ name: "Alice" });
    const bob = insertTestUser({ name: "Bob" });
    insertTestAccount({ id: "alice-acct", userId: alice });
    insertTestAccount({ id: "bob-acct", userId: bob });

    const aliceOnly = listAccounts(alice);
    expect(aliceOnly.map((a) => a.id)).toEqual(["alice-acct"]);
    expect(listAccounts(bob).map((a) => a.id)).toEqual(["bob-acct"]);
  });
});
