CREATE TABLE workspace_github_credentials (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX workspace_github_credentials_run ON workspace_github_credentials(run_id);
