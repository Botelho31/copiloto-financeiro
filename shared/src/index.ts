// Wire-format types shared between backend and frontend. Field names mirror
// the API JSON responses (snake_case where the backend returns snake_case).

export * from "./amortization";

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
  updated_at: string;
}

export interface Investment {
  id: string;
  item_id: string;
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

export interface Category {
  id: number;
  name: string;
  kind: string;
  parent_id: number | null;
  // True for categories like "Transfers" and "Savings & Investments" — real
  // money movement, but not income/spend, so it's excluded from cash-flow
  // totals while still visible in category breakdowns.
  excludes_from_cashflow: boolean;
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
  // The debt this bill's payment actually pays down (e.g. a mortgage's
  // monthly payment bill linked to the mortgage), if any — the two are
  // otherwise unrelated records describing the same real-world payment.
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
  }[];
  /** Bills flagged is_card_expense — informational only, not part of net/balance (already folded into the cardSpend line above). */
  cardExpenseBills: { id: number; name: string; amount: number }[];
}

export interface ProjectionResult {
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
  linked_debts: { id: number; name: string; principal: number }[];
}

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
