import { beforeEach, describe, expect, test } from "bun:test";
import { insertTestAccount, insertTestUser, resetDb } from "../test/helpers";
import { listAccounts } from "./accounts";

beforeEach(() => resetDb());

describe("listAccounts — user scoping", () => {
  test("null userId (Household) returns every person's accounts combined", async () => {
    const alice = await insertTestUser({ name: "Alice" });
    const bob = await insertTestUser({ name: "Bob" });
    await insertTestAccount({ id: "alice-acct", userId: alice });
    await insertTestAccount({ id: "bob-acct", userId: bob });

    const all = await listAccounts(null);
    expect(all.map((a) => a.id).sort()).toEqual(["alice-acct", "bob-acct"]);
  });

  test("a specific userId only returns that person's accounts", async () => {
    const alice = await insertTestUser({ name: "Alice" });
    const bob = await insertTestUser({ name: "Bob" });
    await insertTestAccount({ id: "alice-acct", userId: alice });
    await insertTestAccount({ id: "bob-acct", userId: bob });

    const aliceOnly = await listAccounts(alice);
    expect(aliceOnly.map((a) => a.id)).toEqual(["alice-acct"]);
    expect((await listAccounts(bob)).map((a) => a.id)).toEqual(["bob-acct"]);
  });
});
