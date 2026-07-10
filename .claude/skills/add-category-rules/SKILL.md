---
name: add-category-rules
description: >-
  Finds recurring uncategorized transactions and creates category_rules for
  them (substring match against normalized description -> category),
  applying each rule retroactively. Use when the user asks to categorize
  transactions, clean up "Uncategorized", set up category rules, or run
  categorization. On demand, not an automatic background job.
---

# Add Category Rules

A `category_rule` is a plain substring match (case/accent-insensitive)
against a transaction's normalized description, applied automatically to
every future transaction during sync. This skill is the pass that finds
what rules are worth creating and creates them — it does not touch already-
categorized transactions (that's `reclassify_matching`, a different job: fixing
a rule that was too broad or plain wrong, not adding new coverage).

## Steps

1. `get_uncategorized_groups` (default 30-day lookback; widen with `days` if
   the recent window looks thin) — groups still-Uncategorized transactions
   by normalized description, surfacing recurring patterns worth a rule.
2. `list_categories` for the exact existing category names to assign to.
   Never invent a category name that isn't in this list — if nothing fits,
   say so instead of forcing a mismatch or calling `create_category` unasked.
3. For each group that's clearly one category (a recognizable
   merchant/vendor, a recognizable transfer pattern, etc.):
   - Pick match text that's specific enough not to swallow unrelated
     transactions, but general enough to cover the group — usually the
     merchant/counterparty name, not the full raw description.
   - `categorize(matchText, categoryName)` — upserts the rule and applies it
     to every current Uncategorized match in one call.
4. For a group that's ambiguous (could plausibly be more than one category,
   or depends on context this skill doesn't have — e.g. a generic transfer
   that could be a gift, a repayment, or a self-transfer) — don't guess.
   List it for the user instead of creating a rule that might miscategorize
   future transactions too.
5. Report: which rules were created (match text → category, and how many
   existing transactions each one just picked up), and what was left
   unresolved and why.

## Rules

- Prefer specific match text over broad terms — a broad rule applied first
  can steal transactions a later, more specific rule should have caught
  (`categorize`'s own description says this; it matters because rules apply
  in insertion order against whatever's still Uncategorized).
- Never touch a transaction that already has a real category — that's out of
  scope here. If an existing rule looks wrong (miscategorizing things), say
  so and point at `reclassify_matching` rather than doing it as part of this
  pass.
- Card-expense bills and self-transfers are handled by their own detection
  jobs (`detect_recurring_bills`, `detect_self_transfers`) — don't create a
  category rule to work around something one of those should be catching
  instead.
