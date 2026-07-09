import { db } from "../db";

const LOOKBACK_DAYS = 180;
const MIN_OCCURRENCES = 3;
const AMOUNT_TOLERANCE = 0.15;

type Cadence = "weekly" | "monthly";

interface TxRow {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: "CREDIT" | "DEBIT";
  category_id: number | null;
}

export function normalizeDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/\d+/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function detectCadence(dates: string[]): Cadence | null {
  const sorted = [...dates].sort();
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const days = (new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime()) / 86_400_000;
    gaps.push(days);
  }
  const gap = median(gaps);
  if (gap >= 5 && gap <= 9) return "weekly";
  if (gap >= 25 && gap <= 35) return "monthly";
  return null;
}

function addCadence(date: Date, cadence: Cadence): Date {
  const next = new Date(date);
  if (cadence === "weekly") next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

function mostCommonCategoryId(categoryIds: (number | null)[]): number | null {
  const counts = new Map<number, number>();
  for (const id of categoryIds) {
    if (id === null) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

function existingBillKeys(): Set<string> {
  const rows = db.query("SELECT name FROM recurring_bills").all() as { name: string }[];
  return new Set(rows.map((r) => normalizeDescription(r.name)));
}

function categoryKind(categoryId: number | null): string | null {
  if (categoryId == null) return null;
  const row = db.query("SELECT kind FROM categories WHERE id = ?").get(categoryId) as
    | { kind: string }
    | null;
  return row?.kind ?? null;
}

function incomeCategoryId(): number | null {
  const row = db.query("SELECT id FROM categories WHERE kind = 'income' LIMIT 1").get() as
    | { id: number }
    | null;
  return row?.id ?? null;
}

// Detects recurring patterns in both directions — recurring bills (DEBIT)
// and recurring income/revenue (CREDIT), e.g. a salary or a repeating
// client payment. Projection direction is driven by the assigned category's
// kind, not the transaction type, so a detected income pattern needs an
// income-kind category to project correctly — default to "Income" if the
// group's most common category isn't already income-kind.
export function detectRecurringBills(): number {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const transactions = db
    .query(
      `SELECT id, date, description, amount, type, category_id FROM transactions
       WHERE date >= ?`
    )
    .all(since) as TxRow[];

  const groups = new Map<string, TxRow[]>();
  for (const tx of transactions) {
    const key = normalizeDescription(tx.description);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }

  const alreadyTracked = existingBillKeys();
  let created = 0;

  for (const [key, txs] of groups) {
    if (txs.length < MIN_OCCURRENCES || alreadyTracked.has(key)) continue;

    const amounts = txs.map((t) => Math.abs(t.amount));
    const meanAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const withinTolerance = amounts.every(
      (a) => Math.abs(a - meanAmount) / meanAmount <= AMOUNT_TOLERANCE
    );
    if (!withinTolerance) continue;

    const cadence = detectCadence(txs.map((t) => t.date));
    if (!cadence) continue;

    const sortedByDate = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    const lastTx = sortedByDate[sortedByDate.length - 1]!;
    const nextDueDate = addCadence(new Date(lastTx.date), cadence).toISOString().slice(0, 10);
    let categoryId = mostCommonCategoryId(txs.map((t) => t.category_id));

    const creditCount = txs.filter((t) => t.type === "CREDIT").length;
    const isIncomePattern = creditCount > txs.length / 2;
    if (isIncomePattern && categoryKind(categoryId) !== "income") {
      categoryId = incomeCategoryId() ?? categoryId;
    }

    const insert = db
      .query(
        `INSERT INTO recurring_bills (name, category_id, expected_amount, cadence, next_due_date, source, confirmed, active)
         VALUES (?, ?, ?, ?, ?, 'detected', 0, 1)`
      )
      .run(lastTx.description, categoryId, meanAmount, cadence, nextDueDate);

    const billId = Number(insert.lastInsertRowid);
    for (const tx of txs) {
      db.query(
        "INSERT OR IGNORE INTO recurring_bill_matches (recurring_bill_id, transaction_id) VALUES (?, ?)"
      ).run(billId, tx.id);
    }

    alreadyTracked.add(key);
    created += 1;
  }

  return created;
}
