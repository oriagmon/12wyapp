-- Interface language, per user.
--
-- The browser keeps its own copy of this choice in local storage, which is what the UI reads
-- on load. This column exists for everything that runs *without* a browser attached: the WAM
-- reminder cron, BROOST notification emails, monthly summaries and password resets all have
-- to pick a language with no request to read `Accept-Language` from.
--
-- Existing users predate the English release and were using the Hebrew interface, so they are
-- backfilled to 'he'. New rows default to 'en' to match the app's default.

ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';

UPDATE users SET locale = 'he';
