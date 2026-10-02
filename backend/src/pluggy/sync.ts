import { getDb } from "../db";
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

async function getUncategorizedId(): Promise<number> {
  const result = await getDb().execute("SELECT id FROM categories WHERE name = 'Uncategorized'");
  const row = result.rows[0] as unknown as { id: number } | undefined;
  if (!row) throw new Error("Uncategorized category is missing — did migrations run?");
  return row.id;
}

async function categorize(description: string, uncategorizedId: number): Promise<number> {
  const result = await getDb().execute("SELECT match_text, category_id FROM category_rules");
  const rules = result.rows as unknown as { match_text: string; category_id: number }[];
  const normalizedDescription = normalizeDescription(description);
  for (const rule of rules) {
    if (normalizedDescription.includes(normalizeDescription(rule.match_text))) {
      return rule.category_id;
    }
  }
  return uncategorizedId;
}

async function upsertItem(itemId: string, userId: number): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO items (id, user_id, status) VALUES (?, ?, 'active')
          ON CONFLICT(id) DO NOTHING`,
    args: [itemId, userId],
  });
}

async function upsertAccount(account: PluggyAccount, userId: number): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO accounts (id, item_id, user_id, name, type, subtype, balance, currency_code, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            type = excluded.type,
            subtype = excluded.subtype,
            balance = excluded.balance,
            currency_code = excluded.currency_code,
            updated_at = datetime('now')`,
    args: [
      account.id,
      account.itemId,
      userId,
      account.name,
      account.type,
      account.subtype,
      account.balance,
      account.currencyCode,
    ],
  });
}

async function upsertInvestment(investment: PluggyInvestment, userId: number): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO investments (id, item_id, user_id, name, type, subtype, balance, currency_code, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            type = excluded.type,
            subtype = excluded.subtype,
            balance = excluded.balance,
            currency_code = excluded.currency_code,
            status = excluded.status,
            updated_at = datetime('now')`,
    args: [
      investment.id,
      investment.itemId,
      userId,
      investment.name,
      investment.type,
      investment.subtype,
      investment.balance,
      investment.currencyCode,
      investment.status,
    ],
  });
}

async function upsertTransaction(
  tx: PluggyTransaction,
  uncategorizedId: number,
  userId: number
): Promise<boolean> {
  const db = getDb();
  const existingResult = await db.execute({
    sql: "SELECT category_id FROM transactions WHERE id = ?",
    args: [tx.id],
  });
  const existing = existingResult.rows[0] as unknown as { category_id: number | null } | undefined;
  const categoryId = existing?.category_id ?? (await categorize(tx.description, uncategorizedId));

  await db.execute({
    sql: `INSERT INTO transactions
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
            raw_json = excluded.raw_json`,
    args: [
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
      JSON.stringify(tx),
    ],
  });

  return !existing;
}

export async function runSync(user: SyncUser): Promise<{ transactionsUpserted: number }> {
  const db = getDb();
  const logInsert = await db.execute({
    sql: "INSERT INTO sync_log (status, user_id) VALUES ('running', ?)",
    args: [user.id],
  });
  const logId = Number(logInsert.lastInsertRowid);

  let transactionsUpserted = 0;
  const uncategorizedId = await getUncategorizedId();
  const credentials: PluggyCredentials = {
    clientId: user.pluggyClientId,
    clientSecret: user.pluggyClientSecret,
  };

  try {
    for (const itemId of user.pluggyItemIds) {
      await upsertItem(itemId, user.id);

      const accounts = await fetchAccounts(itemId, credentials);
      for (const account of accounts) {
        await upsertAccount(account, user.id);
        const transactions = await fetchTransactions(account.id, credentials);
        for (const tx of transactions) {
          if (await upsertTransaction(tx, uncategorizedId, user.id)) {
            transactionsUpserted += 1;
          }
        }
      }

      const investments = await fetchInvestments(itemId, credentials);
      for (const investment of investments) {
        await upsertInvestment(investment, user.id);
      }

      await db.execute({
        sql: "UPDATE items SET last_synced_at = datetime('now') WHERE id = ?",
        args: [itemId],
      });
    }

    await db.execute({
      sql: "UPDATE sync_log SET finished_at = datetime('now'), status = 'success', transactions_upserted = ? WHERE id = ?",
      args: [transactionsUpserted, logId],
    });

    return { transactionsUpserted };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.execute({
      sql: "UPDATE sync_log SET finished_at = datetime('now'), status = 'error', transactions_upserted = ?, error = ? WHERE id = ?",
      args: [transactionsUpserted, message, logId],
    });
    throw error;
  }
}
