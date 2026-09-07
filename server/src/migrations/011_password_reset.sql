-- Password reset ("forgot password") tokens. Independent of any profile columns (migration
-- 017's users.display_name/bio/avatar_*) — only references users(id), which has existed
-- since 001_init.sql — so this file is safe regardless of whether it applies before or after
-- 017 on any given database.
--
-- Only a SHA-256 hash of the high-entropy random token is ever stored — never the plaintext
-- token itself, and no request metadata (no IP address, no user-agent) is persisted at all,
-- since none of it is needed and IP/UA would be more PII than this feature warrants.
--
-- Rows are never deleted (except via the ON DELETE CASCADE if the user itself is removed) —
-- a token is invalidated by setting used_at, whether because it was actually used for a real
-- reset or because it was superseded by a newer request. Keeping every row (all lookups are
-- by an unguessable hash, so this leaks nothing) lets the account-scoped rate limit below
-- count genuine requests-per-window accurately, independent of that invalidation.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  -- Short-lived: created with expires_at ~45 minutes out (see RESET_TOKEN_TTL_MINUTES in
  -- server/src/lib/passwordReset.ts), within the required 30-60 minute window.
  expires_at TEXT NOT NULL,
  -- NULL until the token becomes unusable (either genuinely consumed by a successful reset,
  -- or invalidated because a newer request/reset superseded it) — single-use in effect.
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Enforces (and makes O(1)) the never-store-plaintext invariant's flip side: two different
-- tokens must never hash-collide into the same lookup row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_hash
  ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
  ON password_reset_tokens(user_id);
-- Backs the per-account rate-limit window query (COUNT(*) WHERE user_id = ? AND created_at >= ?).
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_created
  ON password_reset_tokens(user_id, created_at);
