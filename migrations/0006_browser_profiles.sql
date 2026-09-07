CREATE TABLE browser_profile_generations (
  user_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE browser_profiles (
  user_id TEXT NOT NULL,
  repository_id INTEGER NOT NULL,
  repository_name TEXT NOT NULL,
  generation INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  object_key TEXT,
  archive_id TEXT,
  archive_size INTEGER,
  archive_sha256 TEXT,
  encrypted_size INTEGER,
  updated_at INTEGER,
  last_error TEXT,
  PRIMARY KEY (user_id, repository_id)
);

CREATE INDEX browser_profiles_owner_updated
ON browser_profiles(user_id, updated_at DESC);

CREATE TABLE browser_profile_cleanup (
  object_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delete_after INTEGER NOT NULL
);

CREATE INDEX browser_profile_cleanup_owner
ON browser_profile_cleanup(user_id, delete_after);
