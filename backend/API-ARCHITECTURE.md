# API Architecture

A route-by-route reference for what belongs in `backend/src/routes/*.ts`, plus a record
of financial logic the frontend used to duplicate or reimplement that has since been
moved here (or fixed outright). The "Frontend calculations" section below was originally
written as an audit with open recommendations (R1-R6); all six have since been
implemented — kept here as a record of what was wrong and how it was fixed, since the
same failure mode (a financial computation existing in two places) is worth recognizing
early next time it starts to happen.

## Layering principle

**The backend is the single source of truth for every financial number.** Anything
that touches money — a sum, a percentage, an amortization schedule, a "is this
overdue" date check that feeds a total — belongs in a route/service function, gets
returned as an already-computed field, and the frontend just renders it. The
frontend's job is presentation: sorting, filtering an already-fetched list, choosing a
color, formatting a date.

This isn't pedantry — it's the specific failure mode this app's own code comments
warn about repeatedly (`routes/debts.ts`'s `computePaymentPlan`: _"the single
resolution... so they can't disagree"_; `projectionEngine.ts`'s `debtLineAmountForMonth`:
_"must never disagree with what the real projection converges on"_). Every time a
financial computation exists in two places, one of two things eventually happens: they
drift apart, or someone has to remember to update both. The audit below found both
already happening in the frontend — see R2 and R3.

## File layout: routes vs. services

Two layers, not three — a separate `db`/repository layer was considered and
deliberately skipped for now; every resource already sits on top of `db/index.ts`'s
single `db` instance directly, and a repository layer would mostly just relay calls
with nothing of its own to isolate.

- **`routes/*.ts`** — the HTTP boundary. Parses/validates the request (a Zod schema
  passed as `{ body: MySchema }` — Elysia 1.4+ validates a Zod schema natively via
  Standard Schema support, no adapter needed, and returns a structured 422 automatically
  on a bad request), calls a service or local function, maps a thrown `Error` to an HTTP
  status. For a resource with no real computation to isolate (accounts, investments,
  tags, categories, goals, settings, sync, users), the CRUD functions live directly in
  the route file too — forcing a separate service file on something that's just "parse →
  one query → return" adds indirection with nothing to isolate.
- **`services/*.ts`** — business logic split out only where there's real computation to
  isolate. Today that's `services/debts.ts` (by far the largest and most
  computation-heavy resource — `computeDebt`, `computePaymentPlan`,
  `computeProjectedBalanceSchedule`, `computeBalanceHistory`, plus the debt CRUD
  functions), `services/projectionEngine.ts` (the cash-flow engine, cross-cutting rather
  than owned by one route), and `services/categorization.ts` (auto-categorization,
  shared by sync and the REST/MCP categorization tools). `routes/debts.ts` itself is now
  a thin controller: Zod schemas + calls into `services/debts.ts` + status-code mapping.

**Every mutation is a named, exported function, not inline in the Elysia handler** —
`createBill`/`updateBill`/`deleteBill`, `createDebt`/`updateDebt`/`deleteDebt`, and so on
for every resource, called from that resource's route handler. Originally this was also
what let `mcp-server.ts` call the exact same function a REST request would hit, instead
of maintaining its own parallel copy of the same `INSERT`/`UPDATE` SQL — before that pass,
`bills.ts`, `debts.ts`, `goals.ts`, and `categories.ts` each had their create/update/delete
logic duplicated once in the route handler and again in the matching MCP tool (two places
for the same write to drift apart, the same failure mode as the frontend duplication
above, just one layer over). `users.ts`/`tags.ts` already followed this pattern before
that pass; everything else was brought in line with it.

That's no longer how MCP reaches these functions, though. Once the database was
encrypted at rest (see `ARCHITECTURE.md`'s "Encryption & unlock"), the decryption key
could only safely live in one process's memory — so `mcp-server.ts` stopped importing
these functions at all and became a plain `fetch()` client of this same server's own
`/api/*` routes instead, authenticated with an API key. That's actually a stronger
version of the same guarantee, not a weaker one: a route and its matching MCP tool are
now literally the same HTTP endpoint, not two callers of one function that could still
each call it slightly differently. The named-function convention above still matters —
it's what keeps each route handler itself thin and testable — just not for the
MCP-sharing reason it originally was.

## Routes

### `routes/accounts.ts`, `routes/investments.ts`

Thin passthroughs — list rows, scoped by `userId`. No computation. Correct as-is.

### `routes/transactions.ts`

CRUD + search over the transaction ledger. Categorization side-effects
(`createRule` on `PATCH /:id`) belong here since they write `category_rules`, which
`pluggy/sync.ts` reads during ingest — keeping the write path next to the table it
feeds is right.

### `routes/categories.ts`

Category CRUD, `category_rules` CRUD, and `getUncategorizedGroups` (grouping
still-uncategorized transactions by normalized description). Categories are shared
household-wide by design (see `ARCHITECTURE.md`) — this route intentionally has no
`userId` scoping on the categories themselves, only on the uncategorized-transaction
scan. Two rows also carry behavior flags now (`is_investment_transfer`,
`is_card_bill_payment` — see R5) so the frontend never has to match on a
user-renameable category name to detect them.

### `routes/bills.ts`

Bill CRUD. `is_card_expense`/`confirmed`/`active` are booleans the frontend reads
directly — no derived state here beyond the `debt_name` join for display.

### `services/debts.ts` + `routes/debts.ts` — the most computation-heavy resource, split

`computeDebt` is the one place `split_percentage` + `debt_links` + `debt_transactions`
resolve into `principal`/`remaining`/`percent_complete`. `computePaymentPlan` is the
one place a debt's expected payment is decided (loan formula, linked bills, or the
gated payment-history heuristic — ≥2 payments _and_ coefficient of variation ≤ 0.15,
_and_ not opted out via `override_automatic_schedule`). `computeProjectedBalanceSchedule`
is the one place a debt's future month-by-month balance is walked forward, and
`computeBalanceHistory` (added for R1) is its historical mirror — real past balance,
month by month, from real `pay_off` payments. Between the two, a debt's entire balance
timeline (past and future) is now fully server-computed; the frontend only merges the
two already-computed arrays for charting. All of this lives in `services/debts.ts`;
`routes/debts.ts` is just Zod schemas (`CreateDebtBody`, `UpdateDebtBody`, ...) plus
thin handlers.

### `routes/goals.ts`

`computeGoal` correctly reuses `currentBalance()`/`computeProjection()` from
`projectionEngine.ts` rather than re-deriving net worth independently. Good example
of the layering principle working as intended.

### `routes/projections.ts` / `services/projectionEngine.ts`

The cash-flow engine. Every `ProjectedMonth` line is pre-computed and pre-signed
(income positive, expense negative), and — since R3 — pre-attributed to a
`category_name` (or `null` for a line with no real category, e.g. a debt repayment with
no linked bill or the card-spend goal line) so the frontend never needs to re-derive
_why_ a number is what it is or which category it belongs to, just sum/display it.
`userId: null` means Household (every person combined); a shared debt is one row,
counted once, regardless of scope.

### `routes/settings.ts`

Per-user key-value store (`cardSpendGoal` today). No computation.

### `routes/sync.ts` / `pluggy/sync.ts` / `jobs/dailySync.ts`

Ingest pipeline. `categorize()` (rule matching during sync) is the _only_ place
auto-categorization happens — the frontend never guesses a category, it only ever
displays what sync or an explicit rule assigned.

### `routes/users.ts`

Household member CRUD. `deleteUser` owns the full cascade-delete (accounts,
transactions, bills, debts, goals, settings, sync log) and the two safety guards
(can't delete the last person; can't delete someone still `shared_with_user_id` on an
active debt) — this belongs here, not as a client-side confirmation dialog, because
the guards are data-integrity rules, not UX affordances.

## Frontend calculations — audit and fixes

Found by auditing every `frontend/src/pages/*.tsx` and `frontend/src/components/*.tsx`
against what the backend already computes authoritatively. All six are now fixed.

### R1 — Debts.tsx reimplemented the backend's balance math for a historical chart

`loanStepsWithExtras`/`debtBalanceSeries` used to reimplement `debtLineAmountForMonth`'s
PRICE/SAC + extra-bill-capping logic by hand to draw a _historical_ balance chart,
because `routes/debts.ts` only exposed `projected_balance_schedule` (future-only).
**Fixed:** added `Debt.balance_history` (`computeBalanceHistory` in `routes/debts.ts`) —
the historical mirror of `projected_balance_schedule`, computed from real `pay_off`
payments. `debtBalanceSeries` in `Debts.tsx` is now ~30 lines that just merge
`balance_history` + `projected_balance_schedule` for charting; `loanStepsWithExtras` is
gone entirely, and `DebtOverviewChart` no longer needs its own per-debt transaction
fetch (`useQueries`) or `useBills()` call, since every debt already carries its own
balance timeline.

### R2 — Debts.tsx `PayoffProjection` could disagree with the debt's own displayed date

`plannedMonthlyPayment` used to return `null` for any `plan.source === "loan"` debt, so
`PayoffProjection` fell back to its own `recentAvgPayment` heuristic and a hand-rolled
compounding loop — while the same `DebtCard` already showed the backend's exact
`projected_finish_date` right next to it, and the backend's own regularity gate
(coefficient-of-variation ≤ 0.15, `override_automatic_schedule`) wasn't respected by the
client-side fallback.
**Fixed:** `plannedMonthlyPayment` now returns `plan.monthly_amount` for `"loan"` source
too (a safe, purely-additive read of an already-computed field). `PayoffProjection` no
longer computes a payoff date at all — it renders `debt.projected_finish_date` directly,
and shows nothing (deferring entirely to `PaymentPlanSection`'s explanation) when
`payment_plan.source === "none"`.

### R3 — Category attribution disagreed across three call sites

`Bills.tsx`'s `ProjectedByCategory` and `Dashboard.tsx`'s `topCategoriesOverTime` used to
filter projection lines with `l.kind === "bill" || (l.kind === "debt" && l.billId !=
null)` — silently dropping any debt line without a linked bill — while
`Dashboard.tsx`'s `planningCategoryBreakdown` correctly bucketed those under a synthetic
"Debt Repayment" category.
**Fixed:** every `ProjectedMonth.bills[]` line (and `cardExpenseBills[]` entry) now
carries its own server-computed `category_name: string | null`, attributed once in
`computeProjection` — `null` specifically for a debt line with no linked bill, or for
`interest`/`cardSpend` lines. All three frontend call sites now read `line.category_name`
directly (falling back to "Debt Repayment" for an unlinked debt line, "Uncategorized"
otherwise) instead of independently cross-referencing bill ids — the `billCategoryById`/
`billById` lookup maps are gone from both files.

### R4 — Dashboard.tsx "review mode" trailing average was silently always zero

`reviewVerdict`/`categoryAnomalies` compute a trailing 3-month average by filtering the
_already-fetched_ transaction list for dates before the period start — but the fetch
itself never requested those earlier months, so `trailingAvg` was always `0`, silently
failing the `>= 10` anomaly gate.
**Fixed:** the transaction fetch now widens its `from` date to include the trailing
lookback window specifically in review mode (`fetchFrom` in `Dashboard.tsx`), reusing
the same `REVIEW_LOOKBACK_MONTHS` constant (hoisted to module scope) as
`reviewVerdict`/`categoryAnomalies`. Every other computation on the page stays correct
since they all explicitly bound themselves to `period.start`/`period.end` — the extra
earlier rows just never match those filters.

### R5 — Category-exclusion rules were duplicated as string matching

`Dashboard.tsx` mostly used the backend's `category.excludes_from_cashflow` flag
correctly, but one spot re-derived "is this a savings/investment move" via
`t.category_name === "Savings & Investments"`, and 7 other call sites compared
`t.category_name === "Debt & Credit Card"` by literal string — both silently breakable
by renaming a category via `CategorySelect`.
**Fixed:** added `categories.is_investment_transfer` and `categories.is_card_bill_payment`
(migration `023_category_behavior_flags.sql`, flagged onto the two seeded rows the same
way `excludes_from_cashflow` already flags Transfers/Savings & Investments). All 8
string-match call sites in `Dashboard.tsx` now look these flags up by `category_id`
instead.

### R6 — Net worth was computed independently in two places

`Household.tsx`'s `buildBreakdown` and `Dashboard.tsx`'s `currentCashBalance`/
`currentInvestmentBalance` both filtered accounts by `type === "BANK"|"CREDIT"` and
investments by `status === "ACTIVE"`, then summed — the same predicate, written twice.
**Fixed:** extracted `computeNetWorth(accounts, investments)` to
`frontend/src/lib/netWorth.ts`; both pages call it now instead of re-deriving the sums.

## What's fine to leave client-side

Confirmed via the same audit — not duplicated financial logic, no drift risk:
sorting (`useSortableTable` everywhere), search/filter over an already-fetched list
(`CategorySelect`, `Bills.tsx` filters, `TagPicker`), color/date/money formatting,
`GroupedTransactionList`'s bulk-categorize grouping (ad-hoc UI key, no server
equivalent, not recomputed elsewhere), and `Projections.tsx` in general — it derives
only light captions/chart fields from already-authoritative API fields and was the
best-behaved of the four pages audited.
