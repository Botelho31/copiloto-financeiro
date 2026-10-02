import { getDb } from "../db";
import { normalizeDescription } from "../jobs/recurringDetection";

export interface CategorizeResult {
  categoryId: number;
  matchText: string;
  updated: number;
}

async function requireCategoryId(categoryName: string): Promise<number> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT id FROM categories WHERE name = ?",
    args: [categoryName],
  });
  const category = result.rows[0] as unknown as { id: number } | undefined;
  if (!category) {
    const knownResult = await db.execute("SELECT name FROM categories ORDER BY name");
    const known = (knownResult.rows as unknown as { name: string }[]).map((r) => r.name).join(", ");
    throw new Error(`Unknown category "${categoryName}". Known categories: ${known}`);
  }
  return category.id;
}

// Upserts a category_rule and retroactively applies it to every currently
// "Uncategorized" transaction whose normalized description contains it.
// Rules are matched in insertion order and only ever touch transactions
// still "Uncategorized" at the time — a broad rule applied before a more
// specific one can steal transactions the specific rule should have caught,
// so prefer specific match text over broad ones.
//
// The rule upsert and every transaction update it then applies are one
// atomic unit — a failure partway would otherwise leave the rule created
// but only some of the matching transactions actually recategorized.
export async function applyCategoryRule(
  matchTextInput: string,
  categoryName: string
): Promise<CategorizeResult> {
  const categoryId = await requireCategoryId(categoryName);

  const matchText = normalizeDescription(matchTextInput);
  if (!matchText) {
    throw new Error("Match text does not normalize to a usable pattern.");
  }

  const tx = await getDb().transaction();
  try {
    const existingRuleResult = await tx.execute({
      sql: "SELECT id FROM category_rules WHERE match_text = ?",
      args: [matchText],
    });
    const existingRule = existingRuleResult.rows[0] as unknown as { id: number } | undefined;
    if (existingRule) {
      await tx.execute({
        sql: "UPDATE category_rules SET category_id = ? WHERE id = ?",
        args: [categoryId, existingRule.id],
      });
    } else {
      await tx.execute({
        sql: "INSERT INTO category_rules (match_text, category_id) VALUES (?, ?)",
        args: [matchText, categoryId],
      });
    }

    const candidatesResult = await tx.execute(
      `SELECT t.id, t.description FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE c.name = 'Uncategorized'`
    );
    const candidates = candidatesResult.rows as unknown as { id: string; description: string }[];

    let updated = 0;
    for (const txRow of candidates) {
      if (normalizeDescription(txRow.description).includes(matchText)) {
        await tx.execute({
          sql: "UPDATE transactions SET category_id = ? WHERE id = ?",
          args: [categoryId, txRow.id],
        });
        updated += 1;
      }
    }

    await tx.commit();
    return { categoryId, matchText, updated };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

export async function setTransactionCategory(
  transactionId: string,
  categoryName: string
): Promise<void> {
  const categoryId = await requireCategoryId(categoryName);
  const db = getDb();
  const existingResult = await db.execute({
    sql: "SELECT id FROM transactions WHERE id = ?",
    args: [transactionId],
  });
  if (existingResult.rows.length === 0)
    throw new Error(`Transaction "${transactionId}" not found.`);

  await db.execute({
    sql: "UPDATE transactions SET category_id = ? WHERE id = ?",
    args: [categoryId, transactionId],
  });
}

// Direct override for an explicit set of transaction ids, regardless of
// their current category — unlike applyCategoryRule (which only ever
// touches "Uncategorized" rows), this is for explicitly reclassifying a
// group you already picked (e.g. from list_transactions/search). A single
// SQL statement across every id — already atomic, no transaction needed.
export async function bulkSetCategory(
  transactionIds: string[],
  categoryName: string
): Promise<number> {
  const categoryId = await requireCategoryId(categoryName);
  const placeholders = transactionIds.map(() => "?").join(",");
  await getDb().execute({
    sql: `UPDATE transactions SET category_id = ? WHERE id IN (${placeholders})`,
    args: [categoryId, ...transactionIds],
  });
  return transactionIds.length;
}

// Like applyCategoryRule, but reclassifies every matching transaction
// regardless of its current category — not just "Uncategorized" ones. Use
// this when a description pattern was previously swept into the wrong
// category (e.g. by an overly broad earlier rule) and needs correcting
// everywhere, not just going forward. Same all-or-nothing reasoning as
// applyCategoryRule.
export async function reclassifyMatching(
  matchTextInput: string,
  categoryName: string
): Promise<CategorizeResult> {
  const categoryId = await requireCategoryId(categoryName);
  const matchText = normalizeDescription(matchTextInput);
  if (!matchText) {
    throw new Error("Match text does not normalize to a usable pattern.");
  }

  const tx = await getDb().transaction();
  try {
    const existingRuleResult = await tx.execute({
      sql: "SELECT id FROM category_rules WHERE match_text = ?",
      args: [matchText],
    });
    const existingRule = existingRuleResult.rows[0] as unknown as { id: number } | undefined;
    if (existingRule) {
      await tx.execute({
        sql: "UPDATE category_rules SET category_id = ? WHERE id = ?",
        args: [categoryId, existingRule.id],
      });
    } else {
      await tx.execute({
        sql: "INSERT INTO category_rules (match_text, category_id) VALUES (?, ?)",
        args: [matchText, categoryId],
      });
    }

    const candidatesResult = await tx.execute("SELECT id, description FROM transactions");
    const candidates = candidatesResult.rows as unknown as { id: string; description: string }[];

    let updated = 0;
    for (const txRow of candidates) {
      if (normalizeDescription(txRow.description).includes(matchText)) {
        await tx.execute({
          sql: "UPDATE transactions SET category_id = ? WHERE id = ?",
          args: [categoryId, txRow.id],
        });
        updated += 1;
      }
    }

    await tx.commit();
    return { categoryId, matchText, updated };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}
