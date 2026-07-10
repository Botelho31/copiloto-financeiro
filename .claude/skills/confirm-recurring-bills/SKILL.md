---
name: confirm-recurring-bills
description: >-
  Reviews auto-detected recurring-bill candidates (confirmed: false) and
  confirms the real ones or dismisses the noise. Use when the user asks to
  review recurring bills, clean up pending bills, or confirm detected bills.
  On demand, not an automatic background job.
---

# Confirm Recurring Bills

`detect_recurring_bills` runs automatically after every sync and inserts
candidates with `confirmed: false, active: true, source: 'detected'` —
nothing ever reviews them automatically. This skill is that review pass:
decide per candidate whether it's a real recurring bill worth confirming, or
noise worth dismissing, so the "Pending confirmation" list on the Bills page
doesn't just pile up.

## Steps

1. `list_bills` and keep only `confirmed: false` (the pending/detected ones).
   If none, say so and stop.
2. For each candidate, look at its name, `expected_amount`, `cadence`,
   `next_due_date`, and category:
   - A recognizable recurring merchant/service (subscription, utility,
     rent, salary/income, a known recurring transfer) at a consistent
     amount and cadence → confirm: `update_bill({ id, confirmed: true })`.
   - A one-off transaction the detector mistook for a pattern (amount/timing
     too irregular to actually recur, or clearly a single unrelated
     purchase) → dismiss: `update_bill({ id, active: false })` (this is how
     the app "rejects" a candidate — it stays inactive rather than
     resurfacing).
   - Genuinely unclear (could be recurring, could be coincidence; unfamiliar
     counterparty; ambiguous cadence) — leave it pending and list it for the
     user instead of guessing either way.
3. Report: what got confirmed, what got dismissed (and why, briefly), and
   what's left pending for the user to decide.

## Rules

- A confirmed bill feeds the cash-flow projection directly — confirming a
  false pattern overstates or fabricates future income/expense. When in
  doubt, leave it pending rather than confirm.
- Dismissing (`active: false`) is not the same as deleting — the row stays
  for history/audit, it just stops surfacing as pending and stops
  projecting. Prefer this over `delete_bill` for a detected false positive.
- A pattern that's actually a debt payment (not just a spend on a bill's
  own name) belongs linked to that debt (`update_bill({ debtId })`), not
  just confirmed as a generic bill — check `list_debts` if the counterparty
  matches a known debt before confirming it as a plain bill.
