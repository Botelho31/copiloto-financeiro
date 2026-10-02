import { getDb } from "../db";

// A transfer between the user's own accounts shows up as a real DEBIT on one
// BANK account and a real CREDIT on another, for the same amount, within
// seconds of each other (confirmed pattern: itau -> Nu, R$5721.11, 2s apart).
// Counting both sides as real cash flow inflates Money In/Out for no reason —
// no money actually entered or left the user's finances.
const MATCH_WINDOW_MS = 5 * 60 * 1000;
const AMOUNT_EPSILON = 0.01;

interface TxRow {
  id: string;
  account_id: string;
  date: string;
  amount: number;
  type: "DEBIT" | "CREDIT";
}

async function getCategoryId(name: string): Promise<number> {
  const result = await getDb().execute({
    sql: "SELECT id FROM categories WHERE name = ?",
    args: [name],
  });
  const row = result.rows[0] as unknown as { id: number } | undefined;
  if (!row) throw new Error(`"${name}" category is missing — did migrations run?`);
  return row.id;
}

// Only touches transactions still in "Uncategorized" — anything the user (or
// a rule) already categorized is left alone. Scoped to one person's own
// transactions at a time, so two different people's same-amount transactions
// within the match window are never mistaken for a transfer between them.
export async function detectSelfTransfers(userId: number): Promise<number> {
  const db = getDb();
  const uncategorizedId = await getCategoryId("Uncategorized");
  const transfersId = await getCategoryId("Transfers");

  const result = await db.execute({
    sql: `SELECT t.id, t.account_id, t.date, t.amount, t.type
          FROM transactions t
          JOIN accounts a ON a.id = t.account_id
          WHERE a.type = 'BANK' AND t.category_id = ? AND t.user_id = ?
          ORDER BY t.date`,
    args: [uncategorizedId, userId],
  });
  const rows = result.rows as unknown as TxRow[];

  const matched = new Set<string>();
  let matchedPairs = 0;

  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]!;
    if (matched.has(a.id)) continue;

    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j]!;
      const diffMs = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (diffMs > MATCH_WINDOW_MS) break; // rows sorted ascending by date

      if (matched.has(b.id)) continue;
      if (b.account_id === a.account_id) continue; // must be a different account
      if (a.type === b.type) continue; // must be opposite direction
      if (Math.abs(Math.abs(a.amount) - Math.abs(b.amount)) > AMOUNT_EPSILON) continue;

      matched.add(a.id);
      matched.add(b.id);
      matchedPairs += 1;
      break;
    }
  }

  if (matched.size > 0) {
    const ids = [...matched];
    const placeholders = ids.map(() => "?").join(",");
    await db.execute({
      sql: `UPDATE transactions SET category_id = ? WHERE id IN (${placeholders})`,
      args: [transfersId, ...ids],
    });
  }

  return matchedPairs;
}
