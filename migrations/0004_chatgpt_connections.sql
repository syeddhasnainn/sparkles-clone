CREATE TABLE chatgpt_connections (
  user_id TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  email TEXT,
  plan TEXT,
  credential TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  reconnect_required INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  refresh_lease TEXT,
  refresh_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE chatgpt_device_authorizations (
  user_id TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  interval_ms INTEGER NOT NULL,
  poll_after INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  connection_id TEXT
);

ALTER TABLE agent_sessions ADD COLUMN selection TEXT;
ALTER TABLE agent_sessions ADD COLUMN connection_id TEXT;
ALTER TABLE model_gateway_tokens ADD COLUMN provider TEXT NOT NULL DEFAULT 'openrouter';
ALTER TABLE model_gateway_tokens ADD COLUMN connection_id TEXT;
