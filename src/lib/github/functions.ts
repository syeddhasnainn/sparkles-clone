import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { installationsSchema, repositoriesSchema } from "./api.server";
import {
  disconnectGitHub,
  githubConfigured,
  githubRequest,
  installationUrl,
  requireGitHubUser,
} from "./service.server";
import { readConnection } from "./store.server";

export const getGitHubConnection = createServerFn({ method: "GET" }).handler(async () => {
  const { userId } = await requireGitHubUser();
  const row = await readConnection(userId);

  return {
    configured: githubConfigured(),
    installationUrl: installationUrl(),
    account: row
      ? {
          login: row.login,
          avatarUrl: row.avatar_url,
          reconnectRequired: Boolean(
            row.reconnect_required || row.refresh_expires_at <= Date.now(),
          ),
        }
      : null,
  };
});

export const listGitHubInstallations = createServerFn({ method: "GET" })
  .validator(z.object({ page: z.number().int().min(1).max(10_000).default(1) }))
  .handler(async ({ data }) => {
    const { userId } = await requireGitHubUser();
    const result = await githubRequest(
      userId,
      `/user/installations?per_page=100&page=${data.page}`,
      installationsSchema,
    );

    return {
      installations: result.installations.flatMap((item) =>
        item.suspended_at ? [] : [{ id: item.id, login: item.account.login }],
      ),
      hasMore: result.total_count > data.page * 100,
    };
  });

export const listGitHubRepositories = createServerFn({ method: "GET" })
  .validator(
    z.object({
      installationId: z.number().int().positive(),
      page: z.number().int().min(1).max(10_000).default(1),
    }),
  )
  .handler(async ({ data }) => {
    const { userId } = await requireGitHubUser();
    const result = await githubRequest(
      userId,
      `/user/installations/${data.installationId}/repositories?per_page=100&page=${data.page}`,
      repositoriesSchema,
    );

    return {
      repositories: result.repositories.map((repo) => ({
        id: repo.id,
        installationId: data.installationId,
        name: repo.full_name,
        private: repo.private,
        defaultBranch: repo.default_branch,
        archived: repo.archived,
      })),
      hasMore: result.total_count > data.page * 100,
    };
  });

export const disconnectGitHubAccount = createServerFn({ method: "POST" }).handler(async () => {
  const { userId } = await requireGitHubUser();

  await disconnectGitHub(userId);
});

export type GitHubConnection = Awaited<ReturnType<typeof getGitHubConnection>>;
export type GitHubRepository = Awaited<
  ReturnType<typeof listGitHubRepositories>
>["repositories"][number];
