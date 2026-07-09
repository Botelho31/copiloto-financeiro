-- Small global key-value store for app-wide settings that aren't tied to
-- any single request — e.g. a standing credit-card spending goal that should
-- show up consistently across Projections and the Dashboard, not just as a
-- one-off what-if override.
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
