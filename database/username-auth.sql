-- NEXUS username/password authentication.
-- Apply to the existing D1 database (nexus-memory) before deploying the auth Worker.
-- Existing conversation/memory owner IDs remain valid: migrated users keep their
-- original Supabase UUID as nexus_auth_users.user_id.

CREATE TABLE IF NOT EXISTS nexus_auth_users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 310000,
  legacy_supabase_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (length(username) BETWEEN 3 AND 24)
);

CREATE TABLE IF NOT EXISTS nexus_auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES nexus_auth_users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nexus_auth_sessions_user
  ON nexus_auth_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_nexus_auth_sessions_expiry
  ON nexus_auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS nexus_auth_attempts (
  attempt_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
