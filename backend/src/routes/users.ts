import { Elysia } from "elysia";
import { z } from "zod";
import type { User } from "shared";
import { db } from "../db";
import { testPluggyCredentials } from "../pluggy/client";

interface UserRow {
  id: number;
  name: string;
  color: string;
  pluggy_client_id: string | null;
  pluggy_item_ids: string | null;
}

export function listUsers(): User[] {
  const rows = db
    .query("SELECT id, name, color, pluggy_client_id, pluggy_item_ids FROM users ORDER BY id ASC")
    .all() as UserRow[];
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

function userExists(id: number): boolean {
  return db.query("SELECT id FROM users WHERE id = ?").get(id) != null;
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
export function createUser(input: NewUserInput): User[] {
  if (!input.name) {
    throw new Error("name is required");
  }
  if (db.query("SELECT id FROM users WHERE name = ?").get(input.name)) {
    throw new Error("a person with that name already exists");
  }

  db.query(
    `INSERT INTO users (name, color, pluggy_client_id, pluggy_client_secret, pluggy_item_ids)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    input.name,
    input.color ?? "#6b7280",
    input.pluggyClientId ?? null,
    input.pluggyClientSecret ?? null,
    input.pluggyItemIds ?? null
  );
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
    const row = db
      .query("SELECT pluggy_client_id, pluggy_client_secret FROM users WHERE id = ?")
      .get(input.userId) as {
      pluggy_client_id: string | null;
      pluggy_client_secret: string | null;
    } | null;
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

export function updateUser(id: number, input: UserUpdateInput): User[] {
  if (!userExists(id)) {
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
    db.query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...(values as []));
  }
  return listUsers();
}

export function deleteUser(id: number): User[] {
  if (!userExists(id)) {
    throw new Error(`User ${id} not found`);
  }
  if (db.query("SELECT id FROM users").all().length <= 1) {
    throw new Error("cannot delete the last remaining person");
  }
  const sharedDebt = db
    .query("SELECT id FROM debts WHERE shared_with_user_id = ? AND status = 'active'")
    .get(id);
  if (sharedDebt) {
    throw new Error("unlink this person from any shared debts before deleting");
  }

  const transactionIds = db.query("SELECT id FROM transactions WHERE user_id = ?").all(id) as {
    id: string;
  }[];
  for (const { id: transactionId } of transactionIds) {
    db.query("DELETE FROM transaction_tags WHERE transaction_id = ?").run(transactionId);
    db.query("DELETE FROM debt_transactions WHERE transaction_id = ?").run(transactionId);
    db.query("DELETE FROM recurring_bill_matches WHERE transaction_id = ?").run(transactionId);
  }
  db.query("DELETE FROM transactions WHERE user_id = ?").run(id);
  db.query("DELETE FROM accounts WHERE user_id = ?").run(id);
  db.query("DELETE FROM investments WHERE user_id = ?").run(id);
  db.query("DELETE FROM items WHERE user_id = ?").run(id);

  const debtIds = db.query("SELECT id FROM debts WHERE user_id = ?").all(id) as {
    id: number;
  }[];
  for (const { id: debtId } of debtIds) {
    db.query("DELETE FROM debt_transactions WHERE debt_id = ?").run(debtId);
    db.query("DELETE FROM debt_links WHERE parent_debt_id = ? OR child_debt_id = ?").run(
      debtId,
      debtId
    );
  }
  db.query("DELETE FROM debts WHERE user_id = ?").run(id);

  db.query(
    "DELETE FROM recurring_bill_matches WHERE recurring_bill_id IN (SELECT id FROM recurring_bills WHERE user_id = ?)"
  ).run(id);
  db.query("DELETE FROM recurring_bills WHERE user_id = ?").run(id);
  db.query("DELETE FROM goals WHERE user_id = ?").run(id);
  db.query("DELETE FROM app_settings WHERE user_id = ?").run(id);
  db.query("DELETE FROM sync_log WHERE user_id = ?").run(id);
  db.query("DELETE FROM users WHERE id = ?").run(id);

  return listUsers();
}

export const usersRoutes = new Elysia({ prefix: "/api/users" })
  .get("/", () => listUsers())
  .post("/test-pluggy", ({ body }) => testPluggyConnection(body), {
    body: TestPluggyConnectionBody,
  })
  .post(
    "/",
    ({ body, set }) => {
      try {
        return createUser(body);
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: NewUserBody }
  )
  .patch(
    "/:id",
    ({ params, body, set }) => {
      try {
        return updateUser(Number(params.id), body);
      } catch (error) {
        set.status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: UserUpdateBody }
  )
  .delete("/:id", ({ params, set }) => {
    try {
      return deleteUser(Number(params.id));
    } catch (error) {
      set.status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
