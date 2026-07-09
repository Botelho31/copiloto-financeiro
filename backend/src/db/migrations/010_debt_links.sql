-- Lets one debt's full computed principal feed into another split debt's
-- origin sum — e.g. the whole Estudio Foz architect debt (present AND future
-- installments, not just the ones already paid/linked as transactions)
-- counts toward Juliana's 20% house-cost share, not just whatever's been
-- individually linked as a transaction so far.
CREATE TABLE debt_links (
  parent_debt_id INTEGER NOT NULL REFERENCES debts(id),
  child_debt_id INTEGER NOT NULL REFERENCES debts(id),
  PRIMARY KEY (parent_debt_id, child_debt_id)
);
