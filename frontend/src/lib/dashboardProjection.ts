import type { ProjectedMonth, ProjectionResult } from "shared";

// The Projections page already computes a month-by-month breakdown (bills,
// debts, interest, card spend) — the Dashboard just needs to look a given
// calendar month up in that same data, never recompute any of it itself.
// Every "what's expected" spot on the Dashboard goes through these
// functions so there's exactly one place that knows how to read a
// ProjectedMonth, instead of several slightly-different copies of the same
// find-by-label-and-sum logic.
export function findProjectedMonth(
  projections: ProjectionResult | undefined,
  date: Date
): ProjectedMonth | undefined {
  if (!projections) return undefined;
  const label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return projections.months.find((m) => m.label === label);
}

export interface ExpectedLine {
  id: number;
  name: string;
  amount: number;
  // Present on a real ProjectedMonth.bills line or a cardExpenseBills entry;
  // absent (never populated) only in the sense that a "debt" line with no
  // linked bill carries category_name: null rather than a real name — see
  // DashboardPlanningSection's categoryFor for how that's resolved.
  category_name?: string | null;
  kind?: "bill" | "debt" | "interest" | "cardSpend";
}

// Two different confidence tiers, not one flat "faded = future": committed
// is a real recurring bill, a debt's own known repayment schedule, or
// interest on a real balance — things that will happen essentially as
// stated. Assumed is the card-spend goal/average standing in for spend that
// hasn't happened yet, plus any bill specifically flagged as a future card
// expense with no transaction history of its own (e.g. a planned trip) —
// both are estimates, not facts, and shouldn't be visually conflated with
// the committed tier.
//
// The card-spend line (goal/average/current balance) already represents the
// WHOLE card total — named cardExpenseBills (e.g. a subscription) are a
// known subset of it, not additional spend on top (see
// projectionEngine.ts's activeConfirmedBills comment). Showing both the full
// line and its own named subset would double it up, so only the
// unaccounted-for remainder ("misc") is shown as its own line alongside the
// named ones — the two always sum back to the real total, never past it.
export function splitCommittedAssumed(month: ProjectedMonth | undefined): {
  committed: ExpectedLine[];
  assumed: ExpectedLine[];
} {
  if (!month) return { committed: [], assumed: [] };
  const committed = month.bills.filter(
    (b) => b.kind === "bill" || b.kind === "debt" || b.kind === "interest"
  );
  const cardSpendLine = month.bills.find((b) => b.kind === "cardSpend");
  const knownCardCharges = month.cardExpenseBills.reduce((sum, b) => sum - b.amount, 0);
  const assumed: ExpectedLine[] = [...month.cardExpenseBills];
  if (cardSpendLine) {
    const misc = Math.abs(cardSpendLine.amount) - knownCardCharges;
    if (misc > 0) assumed.push({ ...cardSpendLine, amount: -misc });
  }
  return { committed, assumed };
}

export function sumIncomeExpense(lines: ExpectedLine[]): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  for (const line of lines) {
    if (line.amount >= 0) income += line.amount;
    else expense += -line.amount;
  }
  return { income, expense };
}

// cardExpenseBills (e.g. a known future trip charged to a card) are
// deliberately left out of a ProjectedMonth's own net/bills — that's so the
// Projections page's cash-flow numbers don't double-count them against the
// card-spend goal they're already folded into. But anywhere on the
// Dashboard asking "what's expected," leaving them out would understate it,
// so they're merged back in here, in the one place responsible for that.
export function expectedBreakdown(month: ProjectedMonth | undefined): {
  income: number;
  expense: number;
  lines: ExpectedLine[];
  committed: ExpectedLine[];
  assumed: ExpectedLine[];
} {
  const { committed, assumed } = splitCommittedAssumed(month);
  const lines = [...committed, ...assumed];
  const { income, expense } = sumIncomeExpense(lines);
  return { income, expense, lines, committed, assumed };
}

// Narrower than expectedBreakdown on purpose: this is specifically "what's
// expected to hit a card" (for the per-card spending chart), so it takes
// only recurring expense bills and cardExpenseBills — not debts (Estudio
// Foz is paid by bank transfer, not a card).
export function expectedCardCharges(month: ProjectedMonth | undefined): {
  committed: number;
  assumed: number;
} {
  if (!month) return { committed: 0, assumed: 0 };
  // Committed: a real recurring bill with actual transaction history (e.g.
  // Nubank Ultravioleta) — about as sure as "future" gets. Assumed: same
  // "known subset + unaccounted misc remainder" split as
  // splitCommittedAssumed above (see its comment for why cardExpenseBills
  // is a subset of the cardSpend line's total, not additional spend on top
  // of it) — just returning a total instead of individual line items.
  const committed = -month.bills
    .filter((b) => b.kind === "bill" && b.amount < 0)
    .reduce((sum, b) => sum + b.amount, 0);
  const cardSpendLine = month.bills.find((b) => b.kind === "cardSpend");
  const knownCardCharges = month.cardExpenseBills.reduce((sum, b) => sum - b.amount, 0);
  const misc = cardSpendLine ? Math.max(0, Math.abs(cardSpendLine.amount) - knownCardCharges) : 0;
  const assumed = knownCardCharges + misc;
  return { committed, assumed };
}
