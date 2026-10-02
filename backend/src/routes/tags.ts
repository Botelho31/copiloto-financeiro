import { Elysia } from "elysia";
import { z } from "zod";
import type { Tag } from "shared";
import { getDb } from "../db";

const AUTO_PALETTE = [
  "#4c9a6a",
  "#c98a3e",
  "#5c8b99",
  "#7a8471",
  "#5f7fbf",
  "#9c5b4a",
  "#8c6a9c",
  "#b8763f",
  "#a15c8c",
  "#4a9c8f",
];

export async function listTags(): Promise<Tag[]> {
  const result = await getDb().execute("SELECT id, name, color FROM tags ORDER BY name");
  return result.rows as unknown as Tag[];
}

export async function createTag(name: string, color?: string): Promise<Tag[]> {
  const db = getDb();
  const existingResult = await db.execute({
    sql: "SELECT id FROM tags WHERE name = ?",
    args: [name],
  });
  if (existingResult.rows.length > 0) throw new Error(`Tag "${name}" already exists`);
  const countResult = await db.execute("SELECT COUNT(*) as n FROM tags");
  const count = (countResult.rows[0] as unknown as { n: number }).n;
  const resolvedColor = color ?? AUTO_PALETTE[count % AUTO_PALETTE.length];
  await db.execute({
    sql: "INSERT INTO tags (name, color) VALUES (?, ?)",
    args: [name, resolvedColor],
  });
  return listTags();
}

export async function bulkTag(transactionIds: string[], tagId: number): Promise<number> {
  if (transactionIds.length === 0) return 0;
  const tx = await getDb().transaction();
  try {
    for (const id of transactionIds) {
      await tx.execute({
        sql: "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)",
        args: [id, tagId],
      });
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
  return transactionIds.length;
}

export async function bulkUntag(transactionIds: string[], tagId: number): Promise<number> {
  const placeholders = transactionIds.map(() => "?").join(",");
  await getDb().execute({
    sql: `DELETE FROM transaction_tags WHERE tag_id = ? AND transaction_id IN (${placeholders})`,
    args: [tagId, ...transactionIds],
  });
  return transactionIds.length;
}

const NewTagBody = z.object({ name: z.string().min(1), color: z.string().optional() });
const BulkTagBody = z.object({
  transactionIds: z.array(z.string()).min(1),
  tagId: z.number().int(),
});

export const tagsRoutes = new Elysia({ prefix: "/api/tags" })
  .get("/", () => listTags())
  .post(
    "/",
    async ({ body, set }) => {
      try {
        return await createTag(body.name, body.color);
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: NewTagBody }
  )
  .post(
    "/bulk-tag",
    async ({ body }) => ({ tagged: await bulkTag(body.transactionIds, body.tagId) }),
    {
      body: BulkTagBody,
    }
  )
  .post(
    "/bulk-untag",
    async ({ body }) => ({ untagged: await bulkUntag(body.transactionIds, body.tagId) }),
    { body: BulkTagBody }
  );
