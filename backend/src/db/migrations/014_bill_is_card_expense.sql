-- Marks a bill as "this gets charged to a credit card" — for a bill with
-- no matched transaction history yet (a future expense, not something
-- already happening), the projection engine has no other way to know its
-- cost is already absorbed into the general card-spending goal/average
-- rather than being additional spend on top of it.
ALTER TABLE recurring_bills ADD COLUMN is_card_expense INTEGER NOT NULL DEFAULT 0;
