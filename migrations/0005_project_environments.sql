CREATE TABLE project_environments (
  user_id TEXT NOT NULL,
  repository_id INTEGER NOT NULL,
  repository TEXT NOT NULL,
  variables TEXT NOT NULL,
  variable_count INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, repository_id)
);
