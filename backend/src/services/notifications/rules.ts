import type { NotificationSeverity } from "shared";
import { config } from "../../config";
import { db } from "../../db";
import { computeProjection } from "../projectionEngine";

export interface NotificationDraft {
  ruleKey: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  // Scoped per rule (not globally unique) — the DB constraint is on
  // (user_id, rule_key, dedupe_key) together, so two different rules can
  // reuse the same dedupe_key without colliding.
  dedupeKey: string;
  data?: Record<string, unknown>;
}

// Everything a rule might need to decide whether to fire, gathered once per
// user per sync rather than each rule re-querying independently.
export interface SyncContext {
  userId: number;
  newTransactionIds: string[];
}

export interface NotificationRule {
  key: string;
  evaluate(ctx: SyncContext): NotificationDraft[];
}

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
export const largeTransactionRule: NotificationRule = {
  key: "large_transaction",
  evaluate(ctx) {
    if (ctx.newTransactionIds.length === 0) return [];
    const placeholders = ctx.newTransactionIds.map(() => "?").join(",");
    const rows = db
      .query(
        `SELECT id, description, amount, date FROM transactions
         WHERE id IN (${placeholders}) AND user_id = ?`
      )
      .all(...ctx.newTransactionIds, ctx.userId) as NewTransactionRow[];

    const drafts: NotificationDraft[] = [];
    for (const tx of rows) {
      if (Math.abs(tx.amount) < config.largeTransactionThreshold) continue;
      drafts.push({
        ruleKey: "large_transaction",
        severity: "warning",
        title: `Large transaction: ${formatBRL(Math.abs(tx.amount))}`,
        body: `${tx.description} on ${tx.date}`,
        dedupeKey: tx.id,
        data: { transactionId: tx.id, amount: tx.amount },
      });
    }
    return drafts;
  },
};

// Fires once per calendar month per person — re-evaluating the same
// still-shortfall month on tomorrow's sync is a duplicate of the same
// underlying fact, not a new event, so the dedupeKey is the month label
// itself rather than something that changes every run.
export const projectedShortfallRule: NotificationRule = {
  key: "projected_shortfall",
  evaluate(ctx) {
    const projection = computeProjection({ userId: ctx.userId, horizonMonths: 1 });
    const month = projection.months[0];
    if (!month || !month.shortfall) return [];
    return [
      {
        ruleKey: "projected_shortfall",
        severity: "critical",
        title: `Projected shortfall next month (${month.label})`,
        body: `Projected balance: ${formatBRL(month.balance)}`,
        dedupeKey: month.label,
        data: { month: month.label, balance: month.balance },
      },
    ];
  },
};

// Adding a rule is: write one more NotificationRule and push it here — the
// dispatch loop in dispatch.ts iterates this list generically.
export const ALL_RULES: NotificationRule[] = [largeTransactionRule, projectedShortfallRule];
