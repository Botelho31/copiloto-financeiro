-- This app is meant to run locally/on a trusted network, not behind a login
-- wall — no account, no session, no rate limiting. Drops the single-admin
-- tables from 001_init.sql; the app now serves straight to the SPA.
DROP TABLE admin;
DROP TABLE sessions;
