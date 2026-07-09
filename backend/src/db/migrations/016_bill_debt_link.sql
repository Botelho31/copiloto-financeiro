-- Lets a recurring bill be explicitly tied to the debt it pays down (e.g.
-- a mortgage's monthly payment bill linked to the mortgage debt), instead
-- of the two being unrelated records that happen to describe the same
-- real-world payment.
ALTER TABLE recurring_bills ADD COLUMN debt_id INTEGER REFERENCES debts(id);
