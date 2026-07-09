-- A real-world payment can legitimately be two things at once — e.g. an
-- Estudio Foz installment is both a repayment on that architecture debt AND
-- a house cost that Juliana owes 20% of. transaction_id was the primary key
-- (one debt per transaction); switch to a composite key so a transaction can
-- link to multiple debts.
CREATE TABLE debt_transactions_new (
  debt_id INTEGER NOT NULL REFERENCES debts(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  role TEXT NOT NULL CHECK (role IN ('borrow', 'lend', 'pay_off')),
  PRIMARY KEY (debt_id, transaction_id)
);
INSERT INTO debt_transactions_new (debt_id, transaction_id, role)
  SELECT debt_id, transaction_id, role FROM debt_transactions;
DROP TABLE debt_transactions;
ALTER TABLE debt_transactions_new RENAME TO debt_transactions;
CREATE INDEX idx_debt_transactions_debt ON debt_transactions(debt_id);
CREATE INDEX idx_debt_transactions_transaction ON debt_transactions(transaction_id);
