// Wire-format types shared between backend and frontend. Field names mirror
// the API JSON responses (snake_case where the backend returns snake_case).

export * from "./amortization";
export * from "./billCadence";

// A household member — not a login account (auth stays single-admin); each
// user has their own accounts/transactions/bills/debts/goals, scoped via
// user_id, and their own Pluggy connection. Secret is never sent to the client.
export interface User {
  id: number;
  name: string;
  color: string;
  hasPluggyCredentials: boolean;
  pluggyItemIds: string[];
}

export type PluggyConnectionTestResult = { ok: true } | { ok: false; error: string };

// Global (not per-person) settings that used to live in .env — see
// backend/src/services/appConfig.ts. Secrets are never serialized raw, only
// as a hasXxx flag (same convention as User.hasPluggyCredentials); a blank
// string on update means "leave unchanged."
export interface AppConfig {
  minBuffer: number;
}

export interface Account {
  id: string;
  name: string;
  // Pluggy account types: "BANK" | "CREDIT" | "INVESTMENT" | "LOAN" (kept as
  // a loose string since this app only syncs whatever Items are connected —
  // new types show up automatically without a code change).
  type: string;
  subtype: string;
  balance: number;
  currency_code: string;
  item_id: string;
  user_id: number;
  updated_at: string;
}

export interface Investment {
  id: string;
  item_id: string;
  user_id: number;
  name: string;
  type: string;
  subtype: string | null;
  balance: number;
  currency_code: string;
  status: "ACTIVE" | "TOTAL_WITHDRAWAL" | "PENDING";
}

export interface Transaction {
  id: string;
  account_id: string;
  date: string;
  description: string;
  amount: number;
  type: "CREDIT" | "DEBIT";
  status: string;
  currency_code: string;
  category_id: number | null;
  category_name: string | null;
}

export interface PaginatedTransactions {
  items: Transaction[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Category {
  id: number;
  name: string;
  kind: string;
  parent_id: number | null;
  // True for categories like "Transfers" and "Savings & Investments" — real
  // money movement, but not income/spend, so it's excluded from cash-flow
  // totals while still visible in category breakdowns.
  excludes_from_cashflow: boolean;
  // True only for "Savings & Investments" — money moving into/out of an
  // investment specifically, as opposed to a plain inter-account transfer.
  // Flagged (rather than name-matched) since the category is user-renameable.
  is_investment_transfer: boolean;
  // True only for "Debt & Credit Card" — the aggregate bank-side credit card
  // bill payment, excluded wherever individual card purchases are already
  // counted so the same spend isn't double-counted. Flagged for the same
  // rename-safety reason as is_investment_transfer.
  is_card_bill_payment: boolean;
  color: string;
}

// A cross-cutting label independent of category — e.g. "House build" can
// span transactions in Shopping, Transport, Debt & Credit Card, etc.
export interface Tag {
  id: number;
  name: string;
  color: string;
}

export interface CategoryRule {
  id: number;
  match_text: string;
  category_id: number;
  category_name: string;
}

export interface UncategorizedGroup {
  key: string;
  sampleDescription: string;
  count: number;
  totalAmount: number;
}

export interface Bill {
  id: number;
  name: string;
  category_id: number | null;
  category_name: string | null;
  category_kind: string | null;
  expected_amount: number;
  cadence: "weekly" | "monthly" | "quarterly" | "yearly" | "once";
  next_due_date: string | null;
  recurrence_start_date: string | null;
  recurrence_end_date: string | null;
  is_card_expense: boolean;
  source: string;
  confirmed: boolean;
  active: boolean;
  // The debt this bill's payment pays down, if any — a debt can have several
  // bills linked to it at once (see Debt.payment_plan), so this is a plain
  // many-to-one pointer, not a two-way exclusive relationship.
  debt_id: number | null;
  debt_name: string | null;
}

export interface BillOverride {
  billId: number;
  amount: number;
}

export interface ProjectedMonth {
  monthIndex: number;
  label: string;
  net: number;
  balance: number;
  shortfall: boolean;
  bills: {
    id: number;
    name: string;
    amount: number;
    kind: "bill" | "debt" | "interest" | "cardSpend";
    // The real category name for a "bill" line, or a "debt" line whose
    // schedule comes from a linked payment bill — null for a debt line with
    // no linked bill (no real category to attribute it to; consumers
    // conventionally bucket these under a synthetic "Debt Repayment"), and
    // for "interest"/"cardSpend" lines (also not tied to a real category).
    // Computed once here so every consumer attributes a line to the same
    // category instead of independently cross-referencing bill ids — see
    // backend/API-ARCHITECTURE.md's R3.
    category_name: string | null;
    /** Set on a debt line whose schedule comes from the debt's linked payment
     * bill — lets category tables attribute the amount to that bill's category
     * even though the line itself belongs to the debt. */
    billId?: number;
    /** How much of this line's amount is interest rather than principal —
     * only set on a "debt" line for a formal loan (loan_type + rate on
     * file), where the PRICE/SAC formula makes the split exact. A
     * history/bill-driven debt line has no formula to split from, so it's
     * left unset there rather than guessed at. */
    interestPortion?: number;
  }[];
  /** Bills flagged is_card_expense — informational only, not part of net/balance (already folded into the cardSpend line above). */
  cardExpenseBills: { id: number; name: string; amount: number; category_name: string | null }[];
}

export interface ProjectionResult {
  /** Bank cash plus active investment holdings (e.g. CDBs) — not just what's liquid in checking. */
  startingBalance: number;
  baselineIncome: number;
  baselineExpense: number;
  /** The real 3-month card-spend average, regardless of any cardSpendGoal override applied to baselineExpense. */
  cardSpendActualAverage: number;
  months: ProjectedMonth[];
}

export interface Debt {
  id: number;
  name: string;
  direction: "owed_by_me" | "owed_to_me";
  counterparty: string | null;
  // The household member who owns/tracks this debt entry.
  user_id: number;
  // Set instead of (or alongside) counterparty when the other party is a real
  // household member — e.g. "Juliana owes 20% of Estudio Foz" — rather than
  // an outside person. Purely a typed label: split_percentage/debt_links/
  // debt_transactions still drive all the principal/remaining math, unchanged.
  shared_with_user_id: number | null;
  shared_with_user_name: string | null;
  // True when the debt is being viewed as its owner (user_id); false when
  // viewed by the shared_with_user_id party instead. Always true in the
  // Household (unscoped) view.
  is_owner: boolean;
  principal_amount: number | null;
  split_percentage: number | null;
  expected_total_amount: number | null;
  // The real per-period rate the loan carries (e.g. a bank statement's "Taxa
  // de juros a.m."). When set, drives a real amortization simulation over the
  // linked pay_off transactions (see shared/src/amortization.ts) instead of
  // the flat expected_total_amount proportional split.
  interest_rate_monthly_percent: number | null;
  start_date: string;
  target_payoff_date: string | null;
  status: "active" | "paid_off";
  notes: string | null;
  // Precise, explicit rule for classifying future transactions against this
  // debt (counterparty pattern, amount threshold, role) — distinct from notes
  // (background/context). E.g. "DEBIT to 'Ana Cristina...' > R$1,000 → pay_off;
  // her allowance (≤R$1,000) is not part of this debt."
  matching_rule: string | null;
  // Brazil's two standard amortization systems (SFH/SFI loans, e.g. a CAIXA
  // mortgage) — null for anything that isn't a formal amortizing loan (an
  // informal IOU, a split shared expense, etc.). When set alongside
  // interest_rate_monthly_percent, the projection engine computes this
  // debt's expected monthly payment directly from the loan formula instead
  // of needing real payment history to infer a schedule from.
  loan_type: "price" | "sac" | null;
  // Skips the payment-history heuristic in payment_plan even when the
  // history would otherwise pass the regularity check — for a debt with one
  // or more linked bills already accounting for its payments, where the raw
  // history would double up against them rather than add real information.
  override_automatic_schedule: boolean;
  // Computed server-side from linked transactions:
  principal: number;
  total_paid: number;
  remaining: number;
  percent_complete: number;
  interest_paid_so_far: number | null;
  // Split of `remaining` into outstanding principal vs interest accrued but
  // not yet paid (only populated when interest_rate_monthly_percent is set).
  remaining_principal: number | null;
  remaining_interest: number | null;
  transaction_count: number;
  // Other debts whose full computed principal feeds into this debt's origin
  // sum (e.g. the whole Estudio Foz debt counting toward Juliana's 20% share).
  // countsTowardOrigin is false for a linked child that hasn't started yet
  // (its principal shows here for reference, but isn't folded in until it has).
  linked_debts: { id: number; name: string; principal: number; countsTowardOrigin: boolean }[];
  // How this debt's expected payment is calculated — the single resolution
  // the projection engine also follows, so what the Debts page states and
  // what the cash-flow projection does can never drift apart.
  payment_plan: DebtPaymentPlan;
  // Same idea, extended through time: the calendar date this debt's own
  // schedule (payment_plan, including any extra-amortization bills on a
  // loan) is projected to hit zero — computed with the exact same
  // remaining-balance cap the projection engine uses, so a chart or card
  // stating "pays off in X" can never show a different date than the
  // projection actually converges on. Null if there's no basis to project
  // (payment_plan.source === "none") or the debt isn't active.
  projected_finish_date: string | null;
  // Total interest still to accrue from today through projected_finish_date
  // (on top of interest_paid_so_far) — null whenever there's no rate to
  // accrue interest at all.
  projected_remaining_interest: number | null;
  // Month-by-month "what's still owed" from today (or start_date, for a
  // future debt) through projected_finish_date — principal_owed is the
  // balance right after that month's payment; interest_owed is everything
  // still left to accrue from that point through payoff (a suffix sum, not
  // just that one month's slice), so both reach exactly 0 together at the
  // final entry. Empty whenever projected_finish_date is null (same
  // conditions apply — no basis to project, or the debt isn't active).
  projected_balance_schedule: DebtBalanceScheduleEntry[];
  // The historical mirror of projected_balance_schedule: real past balance,
  // month by month, from real pay_off payments — from start_date through
  // today (empty for a debt that hasn't started yet). Computed server-side
  // so a chart never has to reimplement the amortization/decline math to
  // draw "what this debt's balance actually was."
  balance_history: DebtBalanceHistoryEntry[];
}

export interface DebtBalanceScheduleEntry {
  month: string;
  principal_owed: number;
  interest_owed: number;
}

export interface DebtBalanceHistoryEntry {
  month: string;
  balance: number;
}

export type DebtPaymentPlan =
  | {
      source: "loan";
      loan_type: "price" | "sac";
      // Next applicable month's payment (constant for PRICE; for SAC the
      // schedule declines, so this is just the upcoming one).
      monthly_amount: number;
      rate_monthly_percent: number;
      term_months: number;
      // Bills linked to a loan-type debt don't replace the formula — the
      // computed installment above stays authoritative — but they're real
      // extra amortization payments (e.g. a lump-sum or yearly paydown) that
      // shrink the balance faster than the plain schedule alone, so they're
      // carried here for projections/charts to add on top.
      extra_bills: {
        bill_id: number;
        bill_name: string;
        amount: number;
        cadence: Bill["cadence"];
      }[];
    }
  | {
      // Zero or more explicitly linked bills (each keeping its own real
      // cadence — not flattened into one blended monthly figure), plus
      // optionally the payment-history heuristic layered on top, unless
      // overrideAutomaticSchedule turned it off. At least one of bills/
      // automatic is non-empty/non-null whenever this variant is used.
      source: "combined";
      bills: { bill_id: number; bill_name: string; amount: number; cadence: Bill["cadence"] }[];
      automatic: { monthly_amount: number; payment_count: number } | null;
      overrides_automatic_schedule: boolean;
    }
  | {
      // No basis for a schedule: no linked bills, and either fewer than two
      // linked repayments or amounts that vary too much to extrapolate honestly.
      source: "none";
      payment_count: number;
    };

export interface DebtTransaction {
  transaction_id: string;
  debt_id: number;
  role: "borrow" | "lend" | "pay_off";
}

export type DebtLinkedTransaction = Transaction & {
  role: DebtTransaction["role"];
  // Populated only for pay_off transactions on a debt with a rate set — the
  // split of this specific payment into interest vs principal.
  interest: number | null;
  principal: number | null;
};

export interface AppSettings {
  cardSpendGoal: number | null;
}

export interface Goal {
  id: number;
  name: string;
  target_amount: number;
  target_date: string;
  // Computed server-side:
  required_monthly_savings: number;
  projected_monthly_savings: number;
  on_track: boolean;
}

export interface SyncLogEntry {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  transactions_upserted: number;
  error: string | null;
}
