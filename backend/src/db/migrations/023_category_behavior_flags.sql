-- Two category behaviors the frontend used to detect by matching on
-- category_name — "Savings & Investments" and "Debt & Credit Card" are
-- user-renameable (CategorySelect), so a rename silently broke whichever
-- client-side check relied on the literal string. Flagging the rows instead
-- mirrors excludes_from_cashflow's own pattern (see 003_cashflow_exclusions.sql).
ALTER TABLE categories ADD COLUMN is_investment_transfer INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN is_card_bill_payment INTEGER NOT NULL DEFAULT 0;

-- Money moving into/out of an investment (as opposed to a plain transfer
-- between bank accounts) — used to backward-reconstruct historical
-- investment balance on the Dashboard.
UPDATE categories SET is_investment_transfer = 1 WHERE name = 'Savings & Investments';

-- The aggregate bank-side credit card bill payment — excluded wherever
-- individual card purchases are already being counted, so the same money
-- isn't counted twice (once as the bill payment, once as each purchase behind it).
UPDATE categories SET is_card_bill_payment = 1 WHERE name = 'Debt & Credit Card';
