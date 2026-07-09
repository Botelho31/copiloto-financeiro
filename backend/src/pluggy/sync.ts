import { config } from "../config";
import { db } from "../db";
import { normalizeDescription } from "../jobs/recurringDetection";
import {
  fetchAccounts,
  fetchInvestments,
  fetchTransactions,
  type PluggyAccount,
  type PluggyInvestment,
  type PluggyTransaction,
} from "./client";

function getUncategorizedId(): number {
  const row = db.query("SELECT id FROM categories WHERE name = 'Uncategorized'").get() as
    | { id: number }
    | null;
  if (!row) throw new Error("Uncategorized category is missing — did migrations run?");
  return row.id;
}

function categorize(description: string, uncategorizedId: number): number {
  const rules = db.query("SELECT match_text, category_id FROM category_rules").all() as {
    match_text: string;
    category_id: number;
  }[];
  const normalizedDescription = normalizeDescription(description);
  for (const rule of rules) {
    if (normalizedDescription.includes(normalizeDescription(rule.match_text))) {
      return rule.category_id;
    }
  }
  return uncategorizedId;
}

function upsertItem(itemId: string): void {
  db.query(
    `INSERT INTO items (id, status) VALUES (?, 'active')
     ON CONFLICT(id) DO NOTHING`
  ).run(itemId);
}

function upsertAccount(account: PluggyAccount): void {
  db.query(
    `INSERT INTO accounts (id, item_id, name, type, subtype, balance, currency_code, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       type = excluded.type,
       subtype = excluded.subtype,
       balance = excluded.balance,
       currency_code = excluded.currency_code,
       updated_at = datetime('now')`
  ).run(
    account.id,
    account.itemId,
    account.name,
    account.type,
    account.subtype,
    account.balance,
    account.currencyCode
  );
}

function upsertInvestment(investment: PluggyInvestment): void {
  db.query(
    `INSERT INTO investments (id, item_id, name, type, subtype, balance, currency_code, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       type = excluded.type,
       subtype = excluded.subtype,
       balance = excluded.balance,
       currency_code = excluded.currency_code,
       status = excluded.status,
       updated_at = datetime('now')`
  ).run(
    investment.id,
    investment.itemId,
    investment.name,
    investment.type,
    investment.subtype,
    investment.balance,
    investment.currencyCode,
    investment.status
  );
}

function upsertTransaction(tx: PluggyTransaction, uncategorizedId: number): boolean {
  const existing = db.query("SELECT category_id FROM transactions WHERE id = ?").get(tx.id) as
    | { category_id: number | null }
    | null;
  const categoryId = existing?.category_id ?? categorize(tx.description, uncategorizedId);

  db.query(
    `INSERT INTO transactions
       (id, account_id, date, description, description_raw, amount, type, status, currency_code, category_id, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       date = excluded.date,
       description = excluded.description,
       description_raw = excluded.description_raw,
       amount = excluded.amount,
       type = excluded.type,
       status = excluded.status,
       currency_code = excluded.currency_code,
       raw_json = excluded.raw_json`
  ).run(
    tx.id,
    tx.accountId,
    tx.date,
    tx.description,
    tx.descriptionRaw ?? null,
    tx.amount,
    tx.type,
    tx.status,
    tx.currencyCode,
    categoryId,
    JSON.stringify(tx)
  );

  return !existing;
}

export async function runSync(): Promise<{ transactionsUpserted: number }> {
  const logId = Number(
    db.query("INSERT INTO sync_log (status) VALUES ('running')").run().lastInsertRowid
  );

  let transactionsUpserted = 0;
  const uncategorizedId = getUncategorizedId();

  try {
    for (const itemId of config.pluggyItemIds) {
      upsertItem(itemId);

      const accounts = await fetchAccounts(itemId);
      for (const account of accounts) {
        upsertAccount(account);
        const transactions = await fetchTransactions(account.id);
        for (const tx of transactions) {
          if (upsertTransaction(tx, uncategorizedId)) transactionsUpserted += 1;
        }
      }

      const investments = await fetchInvestments(itemId);
      for (const investment of investments) {
        upsertInvestment(investment);
      }

      db.query("UPDATE items SET last_synced_at = datetime('now') WHERE id = ?").run(itemId);
    }

    db.query(
      "UPDATE sync_log SET finished_at = datetime('now'), status = 'success', transactions_upserted = ? WHERE id = ?"
    ).run(transactionsUpserted, logId);

    return { transactionsUpserted };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.query(
      "UPDATE sync_log SET finished_at = datetime('now'), status = 'error', transactions_upserted = ?, error = ? WHERE id = ?"
    ).run(transactionsUpserted, message, logId);
    throw error;
  }
}
