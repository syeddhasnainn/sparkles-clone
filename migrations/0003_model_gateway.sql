CREATE TABLE model_gateway_tokens (
  token_hash TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  model TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (task_id) REFERENCES agent_sessions(task_id) ON DELETE CASCADE
);
CREATE INDEX model_gateway_tokens_run ON model_gateway_tokens(run_id);
