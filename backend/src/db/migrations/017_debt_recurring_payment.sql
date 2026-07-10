-- Restored tombstone: an abandoned experiment (a flat per-debt payment
-- amount, superseded by the debt→bill payment plan in 018/019) that already
-- ran and was recorded on the production database before its file was
-- deleted. The file must exist again so a fresh database reaches the same
-- schema state as production before 019 drops the column on both.
ALTER TABLE debts ADD COLUMN recurring_payment_amount REAL;
