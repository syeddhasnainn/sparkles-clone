import { repositoriesSchema } from "../github/api.server";
import type { githubRequest } from "../github/service.server";
import type { Repository } from "../../../bridge/contracts";

export async function resolveRepository(
  userId: string,
  selected: Repository,
  read: typeof githubRequest,
): Promise<Repository> {
  for (let page = 1; page <= 100; page++) {
    const result = await read(
      userId,
      `/user/installations/${selected.installationId}/repositories?per_page=100&page=${page}`,
      repositoriesSchema,
    );
    const repository = result.repositories.find((item) => item.id === selected.id);

    if (repository) {
      if (repository.archived) throw new Error("Choose a repository that is not archived.");
      return {
        id: repository.id,
        installationId: selected.installationId,
        name: repository.full_name,
        defaultBranch: repository.default_branch,
      };
    }

    if (page * 100 >= result.total_count) break;
  }

  throw new Error("This repository is no longer accessible through your GitHub connection.");
}
