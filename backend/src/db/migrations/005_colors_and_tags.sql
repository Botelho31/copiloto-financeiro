ALTER TABLE categories ADD COLUMN color TEXT NOT NULL DEFAULT '#6b6b6b';

UPDATE categories SET color = '#4c9a6a' WHERE name = 'Income';
UPDATE categories SET color = '#c98a3e' WHERE name = 'Housing';
UPDATE categories SET color = '#5c8b99' WHERE name = 'Utilities';
UPDATE categories SET color = '#7a8471' WHERE name = 'Groceries';
UPDATE categories SET color = '#5f7fbf' WHERE name = 'Transport';
UPDATE categories SET color = '#9c5b4a' WHERE name = 'Health';
UPDATE categories SET color = '#8c6a9c' WHERE name = 'Subscriptions';
UPDATE categories SET color = '#b8763f' WHERE name = 'Dining Out';
UPDATE categories SET color = '#a15c8c' WHERE name = 'Shopping';
UPDATE categories SET color = '#4a9c8f' WHERE name = 'Entertainment';
UPDATE categories SET color = '#b5542d' WHERE name = 'Debt & Credit Card';
UPDATE categories SET color = '#c9a227' WHERE name = 'Savings & Investments';
UPDATE categories SET color = '#6b6b6b' WHERE name = 'Uncategorized';
UPDATE categories SET color = '#7d8ba3' WHERE name = 'Transfers';

-- Tags are a separate, cross-cutting label — e.g. "House build" can span
-- transactions in Shopping, Transport, Debt & Credit Card, etc. Many-to-many
-- since a transaction could reasonably belong to more than one project/tag.
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL
);

CREATE TABLE transaction_tags (
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (transaction_id, tag_id)
);
CREATE INDEX idx_transaction_tags_tag ON transaction_tags(tag_id);
