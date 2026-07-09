import { db } from "../db";
import { normalizeDescription } from "../jobs/recurringDetection";

export interface CategorizeResult {
  categoryId: number;
  matchText: string;
  updated: number;
}

// Upserts a category_rule and retroactively applies it to every currently
// "Uncategorized" transaction whose normalized description contains it.
// Rules are matched in insertion order and only ever touch transactions
// still "Uncategorized" at the time — a broad rule applied before a more
// specific one can steal transactions the specific rule should have caught,
// so prefer specific match text over broad ones.
export function applyCategoryRule(matchTextInput: string, categoryName: string): CategorizeResult {
  const category = db.query("SELECT id FROM categories WHERE name = ?").get(categoryName) as
    | { id: number }
    | null;
  if (!category) {
    const known = (db.query("SELECT name FROM categories ORDER BY name").all() as { name: string }[])
      .map((r) => r.name)
      .join(", ");
    throw new Error(`Unknown category "${categoryName}". Known categories: ${known}`);
  }

  const matchText = normalizeDescription(matchTextInput);
  if (!matchText) {
    throw new Error("Match text does not normalize to a usable pattern.");
  }

  const existingRule = db.query("SELECT id FROM category_rules WHERE match_text = ?").get(matchText) as
    | { id: number }
    | null;
  if (existingRule) {
    db.query("UPDATE category_rules SET category_id = ? WHERE id = ?").run(category.id, existingRule.id);
  } else {
    db.query("INSERT INTO category_rules (match_text, category_id) VALUES (?, ?)").run(
      matchText,
      category.id
    );
  }

  const candidates = db
    .query(
      `SELECT t.id, t.description FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE c.name = 'Uncategorized'`
    )
    .all() as { id: string; description: string }[];

  let updated = 0;
  for (const tx of candidates) {
    if (normalizeDescription(tx.description).includes(matchText)) {
      db.query("UPDATE transactions SET category_id = ? WHERE id = ?").run(category.id, tx.id);
      updated += 1;
    }
  }

  return { categoryId: category.id, matchText, updated };
}

export function setTransactionCategory(transactionId: string, categoryName: string): void {
  const category = db.query("SELECT id FROM categories WHERE name = ?").get(categoryName) as
    | { id: number }
    | null;
  if (!category) {
    const known = (db.query("SELECT name FROM categories ORDER BY name").all() as { name: string }[])
      .map((r) => r.name)
      .join(", ");
    throw new Error(`Unknown category "${categoryName}". Known categories: ${known}`);
  }
  const existing = db.query("SELECT id FROM transactions WHERE id = ?").get(transactionId);
  if (!existing) throw new Error(`Transaction "${transactionId}" not found.`);

  db.query("UPDATE transactions SET category_id = ? WHERE id = ?").run(category.id, transactionId);
}

function requireCategoryId(categoryName: string): number {
  const category = db.query("SELECT id FROM categories WHERE name = ?").get(categoryName) as
    | { id: number }
    | null;
  if (!category) {
    const known = (db.query("SELECT name FROM categories ORDER BY name").all() as { name: string }[])
      .map((r) => r.name)
      .join(", ");
    throw new Error(`Unknown category "${categoryName}". Known categories: ${known}`);
  }
  return category.id;
}

// Direct override for an explicit set of transaction ids, regardless of
// their current category — unlike applyCategoryRule (which only ever
// touches "Uncategorized" rows), this is for explicitly reclassifying a
// group you already picked (e.g. from list_transactions/search).
export function bulkSetCategory(transactionIds: string[], categoryName: string): number {
  const categoryId = requireCategoryId(categoryName);
  const placeholders = transactionIds.map(() => "?").join(",");
  db.query(`UPDATE transactions SET category_id = ? WHERE id IN (${placeholders})`).run(
    categoryId,
    ...transactionIds
  );
  return transactionIds.length;
}

// Like applyCategoryRule, but reclassifies every matching transaction
// regardless of its current category — not just "Uncategorized" ones. Use
// this when a description pattern was previously swept into the wrong
// category (e.g. by an overly broad earlier rule) and needs correcting
// everywhere, not just going forward.
export function reclassifyMatching(matchTextInput: string, categoryName: string): CategorizeResult {
  const categoryId = requireCategoryId(categoryName);
  const matchText = normalizeDescription(matchTextInput);
  if (!matchText) {
    throw new Error("Match text does not normalize to a usable pattern.");
  }

  const existingRule = db.query("SELECT id FROM category_rules WHERE match_text = ?").get(matchText) as
    | { id: number }
    | null;
  if (existingRule) {
    db.query("UPDATE category_rules SET category_id = ? WHERE id = ?").run(categoryId, existingRule.id);
  } else {
    db.query("INSERT INTO category_rules (match_text, category_id) VALUES (?, ?)").run(
      matchText,
      categoryId
    );
  }

  const candidates = db.query("SELECT id, description FROM transactions").all() as {
    id: string;
    description: string;
  }[];

  let updated = 0;
  for (const tx of candidates) {
    if (normalizeDescription(tx.description).includes(matchText)) {
      db.query("UPDATE transactions SET category_id = ? WHERE id = ?").run(categoryId, tx.id);
      updated += 1;
    }
  }

  return { categoryId, matchText, updated };
}
