---
name: reconcile-debts
description: >-
  Applies each active debt's matching_rule against transactions not yet
  linked to it, and links the clear matches via link_transactions_to_debt.
  Use when the user asks to reconcile debts, catch up debt linking, run debt
  matching rules, or check whether new transactions belong to an existing
  debt. On demand — not an automatic background job.
---

# Reconcile Debts

Every active debt can carry a `matching_rule`: a short prose description of
which transactions belong to it (counterparty pattern, amount threshold,
role) — e.g. _"any DEBIT to 'Ana Cristina...' > R$1,000 → pay_off; her
regular allowance (≤R$1,000) is not part of this debt."_ Nothing applies this
automatically. This skill is the manual pass: read the rule, find matching
unlinked transactions, link the clear ones, flag the rest.

## Steps

1. `list_debts` and keep only `status: "active"` debts with a non-null
   `matching_rule`. Nothing to do for debts without one.
2. For each debt:
   - `get_debt_transactions` for its id — note every transaction id already
     linked (any role), so it's never re-matched.
   - `list_transactions`, scoped to what the rule implies: `from` at the
     debt's own `start_date`, `descriptionContains`/`descriptionRegex` for
     the counterparty pattern the rule names. Prefer a tight filter over
     pulling everything and filtering by eye.
   - Read the rule against each candidate: counterparty, amount, date,
     direction (DEBIT/CREDIT). Exclude anything already linked (previous
     step) and anything the rule explicitly carves out (e.g. a stated
     allowance/threshold below the debt's own pattern).
   - Link the ones the rule clearly covers: `link_transactions_to_debt` with
     the role the rule specifies (`borrow` / `lend` / `pay_off`).
3. Report per debt: how many were newly linked (and their role), plus a
   short list of anything skipped because the rule didn't clearly resolve it
   — don't silently drop these, the user decides on ambiguous ones.

## Rules

- Never guess past what the rule states. A debt's interest/payoff/projection
  math all reads off these links — a wrong one corrupts real figures, not
  just a label.
- Respect explicit exclusions in the rule text exactly as written, even when
  a transaction looks close.
- This only _applies_ existing `matching_rule` text — it doesn't write or
  edit rules. If a rule reads stale or wrong for what's actually showing up
  in transactions, say so; don't rewrite it unasked.
