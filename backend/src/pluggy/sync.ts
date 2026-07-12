import { db } from "../db";
import { normalizeDescription } from "../jobs/recurringDetection";
import {
  fetchAccounts,
  fetchInvestments,
  fetchTransactions,
  type PluggyAccount,
  type PluggyCredentials,
  type PluggyInvestment,
  type PluggyTransaction,
} from "./client";

export interface SyncUser {
  id: number;
  pluggyClientId: string;
  pluggyClientSecret: string;
  pluggyItemIds: string[];
}

function getUncategorizedId(): number {
  const row = db.query("SELECT id FROM categories WHERE name = 'Uncategorized'").get() as {
    id: number;
  } | null;
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

function upsertItem(itemId: string, userId: number): void {
  db.query(
    `INSERT INTO items (id, user_id, status) VALUES (?, ?, 'active')
     ON CONFLICT(id) DO NOTHING`
  ).run(itemId, userId);
}

function upsertAccount(account: PluggyAccount, userId: number): void {
  db.query(
    `INSERT INTO accounts (id, item_id, user_id, name, type, subtype, balance, currency_code, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
    userId,
    account.name,
    account.type,
    account.subtype,
    account.balance,
    account.currencyCode
  );
}

function upsertInvestment(investment: PluggyInvestment, userId: number): void {
  db.query(
    `INSERT INTO investments (id, item_id, user_id, name, type, subtype, balance, currency_code, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
    userId,
    investment.name,
    investment.type,
    investment.subtype,
    investment.balance,
    investment.currencyCode,
    investment.status
  );
}

function upsertTransaction(
  tx: PluggyTransaction,
  uncategorizedId: number,
  userId: number
): boolean {
  const existing = db.query("SELECT category_id FROM transactions WHERE id = ?").get(tx.id) as {
    category_id: number | null;
  } | null;
  const categoryId = existing?.category_id ?? categorize(tx.description, uncategorizedId);

  db.query(
    `INSERT INTO transactions
       (id, account_id, user_id, date, description, description_raw, amount, type, status, currency_code, category_id, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    userId,
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

export async function runSync(
  user: SyncUser
): Promise<{ transactionsUpserted: number; newTransactionIds: string[] }> {
  const logId = Number(
    db.query("INSERT INTO sync_log (status, user_id) VALUES ('running', ?)").run(user.id)
      .lastInsertRowid
  );

  let transactionsUpserted = 0;
  const newTransactionIds: string[] = [];
  const uncategorizedId = getUncategorizedId();
  const credentials: PluggyCredentials = {
    clientId: user.pluggyClientId,
    clientSecret: user.pluggyClientSecret,
  };

  try {
    for (const itemId of user.pluggyItemIds) {
      upsertItem(itemId, user.id);

      const accounts = await fetchAccounts(itemId, credentials);
      for (const account of accounts) {
        upsertAccount(account, user.id);
        const transactions = await fetchTransactions(account.id, credentials);
        for (const tx of transactions) {
          if (upsertTransaction(tx, uncategorizedId, user.id)) {
            transactionsUpserted += 1;
            newTransactionIds.push(tx.id);
          }
        }
      }

      const investments = await fetchInvestments(itemId, credentials);
      for (const investment of investments) {
        upsertInvestment(investment, user.id);
      }

      db.query("UPDATE items SET last_synced_at = datetime('now') WHERE id = ?").run(itemId);
    }

    db.query(
      "UPDATE sync_log SET finished_at = datetime('now'), status = 'success', transactions_upserted = ? WHERE id = ?"
    ).run(transactionsUpserted, logId);

    return { transactionsUpserted, newTransactionIds };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.query(
      "UPDATE sync_log SET finished_at = datetime('now'), status = 'error', transactions_upserted = ?, error = ? WHERE id = ?"
    ).run(transactionsUpserted, message, logId);
    throw error;
  }
}
