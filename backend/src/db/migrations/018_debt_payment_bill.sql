-- Inverts the debt↔bill payment link: the debt now owns the pointer to the
-- recurring bill that pays it down (a payment plan is a property of the debt,
-- with its balance and payoff), instead of the bill knowing about the debt.
-- Existing bill→debt links are carried over before the old column is dropped.
ALTER TABLE debts ADD COLUMN payment_bill_id INTEGER REFERENCES recurring_bills(id);

UPDATE debts
SET payment_bill_id = (
  SELECT b.id FROM recurring_bills b WHERE b.debt_id = debts.id ORDER BY b.id LIMIT 1
);

ALTER TABLE recurring_bills DROP COLUMN debt_id;
