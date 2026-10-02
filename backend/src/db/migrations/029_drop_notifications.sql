-- Notifications only ever fired off a sync, and sync now only runs on
-- unlock (see 027_drop_auth.sql's sibling change replacing the cron
-- scheduler) — a push/email/WhatsApp alert that can only ever arrive while
-- you already have the app open defeats the point of a proactive alert, so
-- the whole notification subsystem (rules, providers, delivery log) is
-- removed rather than kept around unused. Drop children (FK to notifications)
-- before the parent table.
DROP TABLE notification_deliveries;
DROP TABLE notifications;
DROP TABLE notification_providers;
DROP TABLE notification_rule_settings;
