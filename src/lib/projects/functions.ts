import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { repositorySchema } from "../../../bridge/contracts";
import { environmentVariablesSchema } from "../../../bridge/project-environment";
import { requireGitHubUser } from "../github/service.server";
import { authorizeRepository } from "../workspaces/github.server";
import { createProjectEnvironmentStore } from "./store";

const store = () => createProjectEnvironmentStore(env.DB, env.GITHUB_TOKEN_ENCRYPTION_KEY);

export const listProjects = createServerFn({ method: "GET" }).handler(async () => {
  const { userId } = await requireGitHubUser();
  const [saved, workspaces] = await Promise.all([
    store().list(userId),
    env.WORKSPACES.getByName(userId).list(),
  ]);
  const projects = new Map(saved.map((project) => [project.repository.id, project]));
  for (const workspace of workspaces) {
    if (!projects.has(workspace.repository.id))
      projects.set(workspace.repository.id, {
        repository: workspace.repository,
        variableCount: 0,
        revision: 0,
      });
  }
  return [...projects.values()].sort((a, b) => a.repository.name.localeCompare(b.repository.name));
});

export const getProjectEnvironment = createServerFn({ method: "POST" })
  .validator(z.object({ repository: repositorySchema }))
  .handler(async ({ data }) => {
    const { userId } = await requireGitHubUser();
    const repository = await authorizeRepository(userId, data.repository);
    return store().read(userId, repository.id);
  });

export const saveProjectEnvironment = createServerFn({ method: "POST" })
  .validator(
    z.object({
      repository: repositorySchema,
      variables: environmentVariablesSchema,
      revision: z.number().int().nonnegative(),
    }),
  )
  .handler(async ({ data }) => {
    const { userId } = await requireGitHubUser();
    const repository = await authorizeRepository(userId, data.repository);
    return store().save(userId, repository, data.variables, data.revision);
  });
