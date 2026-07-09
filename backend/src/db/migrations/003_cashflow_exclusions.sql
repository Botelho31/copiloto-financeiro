ALTER TABLE categories ADD COLUMN excludes_from_cashflow INTEGER NOT NULL DEFAULT 0;

INSERT INTO categories (name, kind) VALUES ('Transfers', 'expense');

UPDATE categories SET excludes_from_cashflow = 1 WHERE name IN ('Savings & Investments', 'Transfers');
