CREATE TABLE agent_sessions (
  task_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'starting',
  cursor INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE(task_id, user_id)
);
CREATE INDEX agent_sessions_user ON agent_sessions(user_id, updated_at DESC);

CREATE TABLE agent_events (
  task_id TEXT NOT NULL REFERENCES agent_sessions(task_id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(task_id, event_id)
);

CREATE TABLE agent_commands (
  task_id TEXT NOT NULL REFERENCES agent_sessions(task_id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(task_id, request_id)
);

CREATE TABLE agent_checkpoints (
  task_id TEXT NOT NULL REFERENCES agent_sessions(task_id) ON DELETE CASCADE,
  checkpoint_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  metadata TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(task_id, checkpoint_id)
);
CREATE INDEX agent_checkpoints_latest ON agent_checkpoints(task_id, created_at DESC);
