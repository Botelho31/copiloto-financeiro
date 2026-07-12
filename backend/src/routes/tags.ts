import { Elysia } from "elysia";
import { z } from "zod";
import type { Tag } from "shared";
import { db } from "../db";

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

export function listTags(): Tag[] {
  return db.query("SELECT id, name, color FROM tags ORDER BY name").all() as Tag[];
}

export function createTag(name: string, color?: string): Tag[] {
  const existing = db.query("SELECT id FROM tags WHERE name = ?").get(name);
  if (existing) throw new Error(`Tag "${name}" already exists`);
  const count = (db.query("SELECT COUNT(*) as n FROM tags").get() as { n: number }).n;
  const resolvedColor = color ?? AUTO_PALETTE[count % AUTO_PALETTE.length];
  db.query("INSERT INTO tags (name, color) VALUES (?, ?)").run(name, resolvedColor);
  return listTags();
}

export function bulkTag(transactionIds: string[], tagId: number): number {
  for (const id of transactionIds) {
    db.query("INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)").run(
      id,
      tagId
    );
  }
  return transactionIds.length;
}

export function bulkUntag(transactionIds: string[], tagId: number): number {
  const placeholders = transactionIds.map(() => "?").join(",");
  db.query(
    `DELETE FROM transaction_tags WHERE tag_id = ? AND transaction_id IN (${placeholders})`
  ).run(tagId, ...transactionIds);
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
    ({ body, set }) => {
      try {
        return createTag(body.name, body.color);
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    { body: NewTagBody }
  )
  .post("/bulk-tag", ({ body }) => ({ tagged: bulkTag(body.transactionIds, body.tagId) }), {
    body: BulkTagBody,
  })
  .post("/bulk-untag", ({ body }) => ({ untagged: bulkUntag(body.transactionIds, body.tagId) }), {
    body: BulkTagBody,
  });
