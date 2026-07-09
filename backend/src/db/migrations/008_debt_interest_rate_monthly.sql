-- Interest accrues per period (monthly), not as one flat lump percentage
-- over the whole loan term. Store the real per-month rate as its own field
-- (e.g. from a bank statement's "Taxa de juros a.m.") instead of deriving a
-- misleading flattened total-over-principal ratio.
ALTER TABLE debts ADD COLUMN interest_rate_monthly_percent REAL;
