import { z } from "zod";
import { repositorySchema, type Repository } from "../../../bridge/contracts";
import {
  environmentVariablesSchema,
  type EnvironmentVariable,
} from "../../../bridge/project-environment";
import { encrypt, decrypt } from "../github/crypto";

const rowSchema = z.object({
  repository: z.string(),
  variables: z.string(),
  variable_count: z.number(),
  revision: z.number(),
  updated_at: z.number(),
});

export function createProjectEnvironmentStore(db: D1Database, key: string) {
  const context = (userId: string, repositoryId: number) =>
    `project-environment:${userId}:${repositoryId}`;
  return {
    async list(userId: string) {
      const { results } = await db
        .prepare(
          "SELECT repository, variable_count, revision, updated_at FROM project_environments WHERE user_id = ? ORDER BY updated_at DESC",
        )
        .bind(userId)
        .all();
      return results.map((value) => {
        const row = rowSchema.omit({ variables: true }).parse(value);
        return {
          repository: repositorySchema.parse(JSON.parse(row.repository)),
          variableCount: row.variable_count,
          revision: row.revision,
        };
      });
    },
    async read(
      userId: string,
      repositoryId: number,
    ): Promise<{ variables: EnvironmentVariable[]; revision: number }> {
      const result = await db
        .prepare(
          "SELECT repository, variables, variable_count, revision, updated_at FROM project_environments WHERE user_id = ? AND repository_id = ?",
        )
        .bind(userId, repositoryId)
        .first();
      if (!result) return { variables: [], revision: 0 };
      const row = rowSchema.parse(result);
      const plaintext = await decrypt(row.variables, key, context(userId, repositoryId));
      return {
        variables: environmentVariablesSchema.parse(JSON.parse(plaintext)),
        revision: row.revision,
      };
    },
    async save(
      userId: string,
      repository: Repository,
      values: EnvironmentVariable[],
      revision: number,
    ) {
      const variables = environmentVariablesSchema.parse(values);
      const ciphertext = await encrypt(
        JSON.stringify(variables),
        key,
        context(userId, repository.id),
      );
      const result =
        revision === 0
          ? await db
              .prepare(
                "INSERT INTO project_environments (user_id, repository_id, repository, variables, variable_count, revision, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?) ON CONFLICT(user_id, repository_id) DO NOTHING",
              )
              .bind(
                userId,
                repository.id,
                JSON.stringify(repository),
                ciphertext,
                variables.length,
                Date.now(),
              )
              .run()
          : await db
              .prepare(
                "UPDATE project_environments SET repository = ?, variables = ?, variable_count = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND repository_id = ? AND revision = ?",
              )
              .bind(
                JSON.stringify(repository),
                ciphertext,
                variables.length,
                Date.now(),
                userId,
                repository.id,
                revision,
              )
              .run();
      if (result.meta.changes !== 1)
        throw new Error(
          "These variables changed in another tab. Reload the project before saving.",
        );
      return { revision: revision + 1 };
    },
  };
}
