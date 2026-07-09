-- Brazil's two standard loan amortization systems: SAC (constant
-- amortization, declining payment) and PRICE (constant payment, growing
-- amortization). Nullable — only meaningful for a debt with a known
-- schedule (e.g. a mortgage), not an informal loan or a split expense.
ALTER TABLE debts ADD COLUMN loan_type TEXT CHECK (loan_type IN ('price', 'sac'));
