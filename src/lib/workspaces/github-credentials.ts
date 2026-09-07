import { z } from "zod";
import { encrypt, decrypt } from "../github/crypto";
import type { GitHubCredentials } from "../../../bridge/github-credentials";
import type { Repository } from "../../../bridge/contracts";

export function workspaceGitHubCredentials(
  db: D1Database,
  secret: string,
  issue: (userId: string, repository: Repository) => Promise<GitHubCredentials>,
  revoke: (token: string) => Promise<void>,
) {
  return {
    async issue(taskId: string, runId: string, repository: Repository) {
      const owner = z
        .object({ user_id: z.string() })
        .parse(
          await db
            .prepare(
              "SELECT user_id FROM agent_sessions WHERE task_id = ? AND run_id = ? AND status NOT IN ('stopped', 'interrupted', 'failed')",
            )
            .bind(taskId, runId)
            .first(),
        );
      const credentials = await issue(owner.user_id, repository);
      const id = crypto.randomUUID();
      try {
        const result = await db
          .prepare(
            "INSERT INTO workspace_github_credentials(id, task_id, run_id, encrypted_token, expires_at) SELECT ?, task_id, run_id, ?, ? FROM agent_sessions WHERE task_id = ? AND run_id = ? AND status NOT IN ('stopped', 'interrupted', 'failed')",
          )
          .bind(
            id,
            await encrypt(credentials.token, secret, id),
            credentials.expiresAt,
            taskId,
            runId,
          )
          .run();
        if (result.meta.changes !== 1)
          throw new Error("Cannot authorize an inactive GitHub workspace run.");
      } catch (error) {
        await revoke(credentials.token);
        throw error;
      }
      return credentials;
    },
    async revoke(runId: string) {
      const result = await db
        .prepare(
          "SELECT id, encrypted_token, expires_at FROM workspace_github_credentials WHERE run_id = ?",
        )
        .bind(runId)
        .all();
      const rows = z
        .array(z.object({ id: z.string(), encrypted_token: z.string(), expires_at: z.number() }))
        .parse(result.results);
      for (const row of rows) {
        if (row.expires_at > Date.now())
          await revoke(await decrypt(row.encrypted_token, secret, row.id));
        await db
          .prepare("DELETE FROM workspace_github_credentials WHERE id = ?")
          .bind(row.id)
          .run();
      }
    },
  };
}
