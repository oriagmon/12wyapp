-- Minimal user profile fields: display name, bio, and an optionally-stored avatar image.
-- Avatar bytes are stored alongside their sniffed MIME type; avatar_version is a monotonic
-- counter bumped on every avatar change (upload or removal) so clients can cache-bust the
-- authenticated avatar image URL without ever needing to expose the raw bytes in JSON.
--
-- Migrations 010-016 are reserved for other queued features; this feature intentionally
-- starts at 017.

ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN avatar_mime TEXT;
ALTER TABLE users ADD COLUMN avatar_data BLOB;
ALTER TABLE users ADD COLUMN avatar_version INTEGER NOT NULL DEFAULT 0;
