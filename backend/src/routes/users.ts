import { Elysia } from "elysia";
import { z } from "zod";
import type { User } from "shared";
import { getDb } from "../db";
import { testPluggyCredentials } from "../pluggy/client";

interface UserRow {
  id: number;
  name: string;
  color: string;
  pluggy_client_id: string | null;
  pluggy_item_ids: string | null;
}

export async function listUsers(): Promise<User[]> {
  const result = await getDb().execute(
    "SELECT id, name, color, pluggy_client_id, pluggy_item_ids FROM users ORDER BY id ASC"
  );
  const rows = result.rows as unknown as UserRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    hasPluggyCredentials: r.pluggy_client_id != null,
    pluggyItemIds: r.pluggy_item_ids
      ? r.pluggy_item_ids
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : [],
  }));
}

async function userExists(id: number): Promise<boolean> {
  const result = await getDb().execute({ sql: "SELECT id FROM users WHERE id = ?", args: [id] });
  return result.rows.length > 0;
}

export const NewUserBody = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  pluggyClientId: z.string().optional(),
  pluggyClientSecret: z.string().optional(),
  pluggyItemIds: z.string().optional(),
});
export type NewUserInput = z.infer<typeof NewUserBody>;

// Structural validation (name non-empty, field types) happens via
// NewUserBody at the REST route boundary — kept here too since this is
// also called directly (tests, and reused if a future caller bypasses the
// route), and name-uniqueness is DB-dependent so can't live in Zod anyway.
export async function createUser(input: NewUserInput): Promise<User[]> {
  if (!input.name) {
    throw new Error("name is required");
  }
  const db = getDb();
  const existingResult = await db.execute({
    sql: "SELECT id FROM users WHERE name = ?",
    args: [input.name],
  });
  if (existingResult.rows.length > 0) {
    throw new Error("a person with that name already exists");
  }

  await db.execute({
    sql: `INSERT INTO users (name, color, pluggy_client_id, pluggy_client_secret, pluggy_item_ids)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      input.name,
      input.color ?? "#6b7280",
      input.pluggyClientId ?? null,
      input.pluggyClientSecret ?? null,
      input.pluggyItemIds ?? null,
    ],
  });
  return listUsers();
}

export const TestPluggyConnectionBody = z.union([
  z.object({ userId: z.number().int() }),
  z.object({ pluggyClientId: z.string().min(1), pluggyClientSecret: z.string().min(1) }),
]);
export type TestPluggyConnectionInput = z.infer<typeof TestPluggyConnectionBody>;

// Two shapes: a saved user (read their stored credentials, for the
// "already added — is this still working" check) or a raw id/secret pair
// (for the "test before you save" button on the add-person form, before
// anything is persisted).
export async function testPluggyConnection(
  input: TestPluggyConnectionInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  let clientId: string | null;
  let clientSecret: string | null;
  if ("userId" in input) {
    const result = await getDb().execute({
      sql: "SELECT pluggy_client_id, pluggy_client_secret FROM users WHERE id = ?",
      args: [input.userId],
    });
    const row = result.rows[0] as unknown as
      { pluggy_client_id: string | null; pluggy_client_secret: string | null } | undefined;
    if (!row) return { ok: false, error: `User ${input.userId} not found` };
    clientId = row.pluggy_client_id;
    clientSecret = row.pluggy_client_secret;
  } else {
    clientId = input.pluggyClientId;
    clientSecret = input.pluggyClientSecret;
  }
  if (!clientId || !clientSecret) {
    return { ok: false, error: "No Pluggy credentials set" };
  }
  return testPluggyCredentials({ clientId, clientSecret });
}

export const UserUpdateBody = z.object({
  name: z.string().optional(),
  color: z.string().optional(),
  pluggyClientId: z.string().nullable().optional(),
  pluggyClientSecret: z.string().optional(),
  pluggyItemIds: z.string().nullable().optional(),
});
export type UserUpdateInput = z.infer<typeof UserUpdateBody>;

export async function updateUser(id: number, input: UserUpdateInput): Promise<User[]> {
  if (!(await userExists(id))) {
    throw new Error(`User ${id} not found`);
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    fields.push("name = ?");
    values.push(input.name);
  }
  if (input.color !== undefined) {
    fields.push("color = ?");
    values.push(input.color);
  }
  if (input.pluggyClientId !== undefined) {
    fields.push("pluggy_client_id = ?");
    values.push(input.pluggyClientId);
  }
  // A blank secret means "leave unchanged" — only overwrite when a real value is sent.
  if (input.pluggyClientSecret) {
    fields.push("pluggy_client_secret = ?");
    values.push(input.pluggyClientSecret);
  }
  if (input.pluggyItemIds !== undefined) {
    fields.push("pluggy_item_ids = ?");
    values.push(input.pluggyItemIds);
  }

  if (fields.length > 0) {
    values.push(id);
    await getDb().execute({
      sql: `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
      args: values as [],
    });
  }
  return listUsers();
}

// A long cascading delete across every person-owned table — all one atomic
// unit. A partial failure here (crash, constraint error) would otherwise
// leave orphaned rows scattered across a dozen tables pointing at a user_id
// that no longer exists, which is a much worse state than the delete simply
// not having happened at all.
export async function deleteUser(id: number): Promise<User[]> {
  if (!(await userExists(id))) {
    throw new Error(`User ${id} not found`);
  }
  const db = getDb();
  const countResult = await db.execute("SELECT id FROM users");
  if (countResult.rows.length <= 1) {
    throw new Error("cannot delete the last remaining person");
  }
  const sharedDebtResult = await db.execute({
    sql: "SELECT id FROM debts WHERE shared_with_user_id = ? AND status = 'active'",
    args: [id],
  });
  if (sharedDebtResult.rows.length > 0) {
    throw new Error("unlink this person from any shared debts before deleting");
  }

  const tx = await db.transaction();
  try {
    const transactionIdsResult = await tx.execute({
      sql: "SELECT id FROM transactions WHERE user_id = ?",
      args: [id],
    });
    const transactionIds = transactionIdsResult.rows as unknown as { id: string }[];
    for (const { id: transactionId } of transactionIds) {
      await tx.execute({
        sql: "DELETE FROM transaction_tags WHERE transaction_id = ?",
        args: [transactionId],
      });
      await tx.execute({
        sql: "DELETE FROM debt_transactions WHERE transaction_id = ?",
        args: [transactionId],
      });
      await tx.execute({
        sql: "DELETE FROM recurring_bill_matches WHERE transaction_id = ?",
        args: [transactionId],
      });
    }
    await tx.execute({ sql: "DELETE FROM transactions WHERE user_id = ?", args: [id] });
    await tx.execute({ sql: "DELETE FROM accounts WHERE user_id = ?", args: [id] });
    await tx.execute({ sql: "DELETE FROM investments WHERE user_id = ?", args: [id] });
    await tx.execute({ sql: "DELETE FROM items WHERE user_id = ?", args: [id] });

    const debtIdsResult = await tx.execute({
      sql: "SELECT id FROM debts WHERE user_id = ?",
      args: [id],
    });
    const debtIds = debtIdsResult.rows as unknown as { id: number }[];
    for (const { id: debtId } of debtIds) {
      await tx.execute({ sql: "DELETE FROM debt_transactions WHERE debt_id = ?", args: [debtId] });
      await tx.execute({
        sql: "DELETE FROM debt_links WHERE parent_debt_id = ? OR child_debt_id = ?",
        args: [debtId, debtId],
      });
    }
    await tx.execute({ sql: "DELETE FROM debts WHERE user_id = ?", args: [id] });

    await tx.execute({
      sql: "DELETE FROM recurring_bill_matches WHERE recurring_bill_id IN (SELECT id FROM recurring_bills WHERE user_id = ?)",
      args: [id],
    });
    await tx.execute({ sql: "DELETE FROM recurring_bills WHERE user_id = ?", args: [id] });
    await tx.execute({ sql: "DELETE FROM goals WHERE user_id = ?", args: [id] });
    await tx.execute({ sql: "DELETE FROM app_settings WHERE user_id = ?", args: [id] });
    await tx.execute({ sql: "DELETE FROM sync_log WHERE user_id = ?", args: [id] });
    await tx.execute({ sql: "DELETE FROM users WHERE id = ?", args: [id] });
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  return listUsers();
}

export const usersRoutes = new Elysia({ prefix: "/api/users" })
  .get("/", () => listUsers())
  .post("/test-pluggy", ({ body }) => testPluggyConnection(body), {
    body: TestPluggyConnectionBody,
  })
  .post(
    "/",
    async ({ body, set }) => {
      try {
        return await createUser(body);
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: NewUserBody }
  )
  .patch(
    "/:id",
    async ({ params, body, set }) => {
      try {
        return await updateUser(Number(params.id), body);
      } catch (error) {
        set.status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: UserUpdateBody }
  )
  .delete("/:id", async ({ params, set }) => {
    try {
      return await deleteUser(Number(params.id));
    } catch (error) {
      set.status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
