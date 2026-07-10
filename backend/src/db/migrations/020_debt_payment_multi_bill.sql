-- Supersedes the single debt->bill pointer: a debt can now have several
-- recurring bills paying it down at once (e.g. two different repayment
-- arrangements), so the FK moves back onto the bill side (many bills can
-- share the same debt_id) rather than a single scalar column on the debt.
ALTER TABLE recurring_bills ADD COLUMN debt_id INTEGER REFERENCES debts(id);

UPDATE recurring_bills
SET debt_id = (SELECT id FROM debts WHERE debts.payment_bill_id = recurring_bills.id);

ALTER TABLE debts DROP COLUMN payment_bill_id;

-- Lets the user say "don't infer a schedule from payment history for this
-- debt, only use its explicitly linked bills" — useful once linked bills
-- exist and the raw history would otherwise double up against them.
ALTER TABLE debts ADD COLUMN override_automatic_schedule INTEGER NOT NULL DEFAULT 0;
