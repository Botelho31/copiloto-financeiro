import { Elysia } from "elysia";
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

export const tagsRoutes = new Elysia({ prefix: "/api/tags" })
  .get("/", () => listTags())
  .post("/", ({ body, set }) => {
    const input = body as { name?: string; color?: string };
    if (!input.name) {
      set.status = 400;
      return { error: "name is required" };
    }
    try {
      return createTag(input.name, input.color);
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? error.message : String(error) };
    }
  })
  .post("/bulk-tag", ({ body, set }) => {
    const input = body as { transactionIds?: string[]; tagId?: number };
    if (!input.transactionIds?.length || !input.tagId) {
      set.status = 400;
      return { error: "transactionIds and tagId are required" };
    }
    return { tagged: bulkTag(input.transactionIds, input.tagId) };
  })
  .post("/bulk-untag", ({ body, set }) => {
    const input = body as { transactionIds?: string[]; tagId?: number };
    if (!input.transactionIds?.length || !input.tagId) {
      set.status = 400;
      return { error: "transactionIds and tagId are required" };
    }
    return { untagged: bulkUntag(input.transactionIds, input.tagId) };
  });
