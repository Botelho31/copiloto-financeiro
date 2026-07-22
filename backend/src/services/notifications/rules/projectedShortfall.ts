import { z } from "zod";
import { db } from "../../../db";
import { computeProjection } from "../../projectionEngine";
import type { NotificationRule } from "./types";

function formatBRL(amount: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
}

// "2026-08" -> "2026-07" — matches projectionEngine.ts's `${year}-${month}`
// month label format exactly.
function previousMonthLabel(label: string): string {
  const [year, month] = label.split("-").map(Number) as [number, number];
  const prev = new Date(year, month - 2, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

// No configurable fields today — an empty schema (rather than omitting one)
// keeps every rule's shape uniform for the settings route/UI.
export const projectedShortfallMetadataSchema = z.object({}).strict();

// Fires once per calendar month per person — re-evaluating the same
// still-shortfall month on tomorrow's sync is a duplicate of the same
// underlying fact, not a new event, so the dedupeKey is the month label
// itself rather than something that changes every run. Still, an unresolved
// shortfall keeps advancing the target month every calendar rollover (next
// month is always "next month"), which would otherwise re-page someone
// every month for a problem they already know about — so this only pages
// on the month the streak actually started (no row for the immediately
// preceding month means either this is the first time, or a healthy month
// broke the streak since); every month after that is still recorded (for
// history/audit) but marked silent, see dispatch.ts.
export const projectedShortfallRule: NotificationRule<Record<string, never>> = {
  key: "projected_shortfall",
  metadataSchema: projectedShortfallMetadataSchema,
  evaluate(ctx) {
    const projection = computeProjection({ userId: ctx.userId, horizonMonths: 1 });
    const month = projection.months[0];
    if (!month || !month.shortfall) return [];

    const alreadyOngoing =
      db
        .query(
          "SELECT 1 FROM notifications WHERE user_id = ? AND rule_key = 'projected_shortfall' AND dedupe_key = ?"
        )
        .get(ctx.userId, previousMonthLabel(month.label)) != null;

    return [
      {
        ruleKey: "projected_shortfall",
        severity: "critical" as const,
        title: `Projected shortfall next month (${month.label})`,
        body: `Projected balance: ${formatBRL(month.balance)}`,
        dedupeKey: month.label,
        data: { month: month.label, balance: month.balance },
        silent: alreadyOngoing,
      },
    ];
  },
};
