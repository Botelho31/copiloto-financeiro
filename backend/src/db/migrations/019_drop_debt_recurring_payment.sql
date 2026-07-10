-- Removes 017's abandoned flat payment amount: never read or written by any
-- code, and the debt→bill payment plan (018) is the real mechanism.
ALTER TABLE debts DROP COLUMN recurring_payment_amount;
