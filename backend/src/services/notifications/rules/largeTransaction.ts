import { z } from "zod";
import { db } from "../../../db";
import type { NotificationRule } from "./types";

export const largeTransactionMetadataSchema = z
  .object({
    largeTransactionThreshold: z.number().positive().default(500),
  })
  .strict();

type LargeTransactionMetadata = z.infer<typeof largeTransactionMetadataSchema>;

function formatBRL(amount: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
}

interface NewTransactionRow {
  id: string;
  description: string;
  amount: number;
  date: string;
}

// Fires once per transaction (dedupeKey = the transaction's own id) the
// first time it's seen large enough to matter — a later sync touching the
// same transaction (e.g. a PENDING -> POSTED status flip) never re-fires it.
export const largeTransactionRule: NotificationRule<LargeTransactionMetadata> = {
  key: "large_transaction",
  metadataSchema: largeTransactionMetadataSchema,
  evaluate(ctx, metadata) {
    if (ctx.newTransactionIds.length === 0) return [];
    const placeholders = ctx.newTransactionIds.map(() => "?").join(",");
    const rows = db
      .query(
        `SELECT id, description, amount, date FROM transactions
         WHERE id IN (${placeholders}) AND user_id = ?`
      )
      .all(...ctx.newTransactionIds, ctx.userId) as NewTransactionRow[];

    const drafts = [];
    for (const tx of rows) {
      if (Math.abs(tx.amount) < metadata.largeTransactionThreshold) continue;
      drafts.push({
        ruleKey: "large_transaction",
        severity: "warning" as const,
        title: `Large transaction: ${formatBRL(Math.abs(tx.amount))}`,
        body: `${tx.description} on ${tx.date}`,
        dedupeKey: tx.id,
        data: { transactionId: tx.id, amount: tx.amount },
      });
    }
    return drafts;
  },
};
