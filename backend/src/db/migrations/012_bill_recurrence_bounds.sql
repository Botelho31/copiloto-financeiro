-- A recurring bill's own life span: when it starts recurring and (optionally)
-- when it stops — e.g. a subscription that only ran March-October, or a
-- fixed-term bill with a known start but open-ended future. Both nullable:
-- no value means "always applied" on that side.
ALTER TABLE recurring_bills ADD COLUMN recurrence_start_date TEXT;
ALTER TABLE recurring_bills ADD COLUMN recurrence_end_date TEXT;
