CREATE TABLE github_connections (
  user_id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  github_user_id INTEGER NOT NULL,
  login TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  credentials TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  refresh_expires_at INTEGER NOT NULL,
  reconnect_required INTEGER NOT NULL DEFAULT 0,
  lock_id TEXT,
  lock_expires_at INTEGER NOT NULL DEFAULT 0,
  connected_at INTEGER NOT NULL
);

CREATE TABLE github_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX github_oauth_states_expiry ON github_oauth_states(expires_at);
