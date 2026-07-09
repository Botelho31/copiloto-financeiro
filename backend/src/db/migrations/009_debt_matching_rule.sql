-- A precise, explicit rule for how to classify new transactions against this
-- debt (counterparty pattern, amount threshold, role) — distinct from notes
-- (background/context). Lets debt-state updates be followed exactly rather
-- than re-derived each time.
ALTER TABLE debts ADD COLUMN matching_rule TEXT;
