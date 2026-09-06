import { env } from "cloudflare:workers";

export interface ConnectionRow {
  user_id: string;
  connection_id: string;
  github_user_id: number;
  login: string;
  avatar_url: string;
  credentials: string;
  expires_at: number;
  refresh_expires_at: number;
  reconnect_required: number;
  lock_id: string | null;
  lock_expires_at: number;
  connected_at: number;
}

export function readConnection(userId: string) {
  return env.DB.prepare("SELECT * FROM github_connections WHERE user_id = ?")
    .bind(userId)
    .first<ConnectionRow>();
}

export async function saveConnection(
  row: Omit<ConnectionRow, "lock_id" | "lock_expires_at" | "reconnect_required">,
) {
  await env.DB.prepare(`
    INSERT INTO github_connections (
      user_id, connection_id, github_user_id, login, avatar_url,
      credentials, expires_at, refresh_expires_at, connected_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      connection_id = excluded.connection_id,
      github_user_id = excluded.github_user_id,
      login = excluded.login,
      avatar_url = excluded.avatar_url,
      credentials = excluded.credentials,
      expires_at = excluded.expires_at,
      refresh_expires_at = excluded.refresh_expires_at,
      connected_at = excluded.connected_at,
      reconnect_required = 0,
      lock_id = NULL,
      lock_expires_at = 0
  `)
    .bind(
      row.user_id,
      row.connection_id,
      row.github_user_id,
      row.login,
      row.avatar_url,
      row.credentials,
      row.expires_at,
      row.refresh_expires_at,
      row.connected_at,
    )
    .run();
}

export async function lockConnection(row: ConnectionRow, lockId: string): Promise<boolean> {
  const result = await env.DB.prepare(`
    UPDATE github_connections
    SET lock_id = ?, lock_expires_at = ?
    WHERE user_id = ?
      AND connection_id = ?
      AND credentials = ?
      AND lock_expires_at <= ?
  `)
    .bind(lockId, Date.now() + 30_000, row.user_id, row.connection_id, row.credentials, Date.now())
    .run();

  return result.meta.changes === 1;
}

export async function unlockConnection(row: ConnectionRow, lockId: string) {
  await env.DB.prepare(`
    UPDATE github_connections
    SET lock_id = NULL, lock_expires_at = 0
    WHERE user_id = ?
      AND connection_id = ?
      AND lock_id = ?
  `)
    .bind(row.user_id, row.connection_id, lockId)
    .run();
}

export async function refreshConnection(
  row: ConnectionRow,
  lockId: string,
  credentials: string,
  expiresAt: number,
  refreshExpiresAt: number,
) {
  const result = await env.DB.prepare(`
    UPDATE github_connections
    SET credentials = ?,
        expires_at = ?,
        refresh_expires_at = ?,
        reconnect_required = 0
    WHERE user_id = ?
      AND connection_id = ?
      AND lock_id = ?
  `)
    .bind(credentials, expiresAt, refreshExpiresAt, row.user_id, row.connection_id, lockId)
    .run();

  return result.meta.changes === 1;
}

export async function requireReconnect(row: ConnectionRow) {
  await env.DB.prepare(`
    UPDATE github_connections
    SET reconnect_required = 1
    WHERE user_id = ?
      AND connection_id = ?
      AND credentials = ?
  `)
    .bind(row.user_id, row.connection_id, row.credentials)
    .run();
}

export async function deleteConnection(row: ConnectionRow, lockId: string) {
  await env.DB.prepare(`
    DELETE FROM github_connections
    WHERE user_id = ?
      AND connection_id = ?
      AND lock_id = ?
  `)
    .bind(row.user_id, row.connection_id, lockId)
    .run();
}

export async function saveOAuthState(
  stateHash: string,
  userId: string,
  sessionId: string,
  verifier: string,
) {
  await env.DB.batch([
    env.DB.prepare(`
      DELETE FROM github_oauth_states
      WHERE expires_at <= ?
        OR (user_id = ? AND session_id = ?)
    `).bind(Date.now(), userId, sessionId),
    env.DB.prepare(`
      INSERT INTO github_oauth_states (state_hash, user_id, session_id, verifier, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(stateHash, userId, sessionId, verifier, Date.now() + 600_000),
  ]);
}

export function consumeOAuthState(stateHash: string, userId: string, sessionId: string) {
  return env.DB.prepare(`
    DELETE FROM github_oauth_states
    WHERE state_hash = ?
      AND user_id = ?
      AND session_id = ?
      AND expires_at > ?
    RETURNING verifier
  `)
    .bind(stateHash, userId, sessionId, Date.now())
    .first<{ verifier: string }>();
}
