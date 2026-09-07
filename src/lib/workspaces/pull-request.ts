import { z } from "zod";
import type { PullRequestSummary, Workspace } from "../../../bridge/contracts";

type GitHubRead = <T>(userId: string, path: string, schema: z.ZodType<T>) => Promise<T>;

const identity = z.object({
  number: z.number().int().positive(),
  head: z.object({ ref: z.string(), repo: z.object({ id: z.number() }).nullable() }),
  base: z.object({ repo: z.object({ id: z.number() }) }),
});
const details = identity.extend({
  state: z.enum(["open", "closed"]),
  draft: z.boolean(),
  merged: z.boolean(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export async function readTaskPullRequest(
  read: GitHubRead,
  userId: string,
  task: Workspace,
  known?: PullRequestSummary | null,
): Promise<PullRequestSummary | null> {
  const branch = `sparkles/${task.id}`;
  const matches = (pull: z.infer<typeof identity>) =>
    pull.head.ref === branch &&
    pull.head.repo?.id === task.repository.id &&
    pull.base.repo.id === task.repository.id;
  let number = known?.number;
  if (!number) {
    const query = new URLSearchParams({
      state: "all",
      head: `${task.repository.name.split("/")[0]}:${branch}`,
      sort: "created",
      direction: "desc",
      per_page: "100",
    });
    const pulls = await read(
      userId,
      `/repos/${task.repository.name}/pulls?${query}`,
      z.array(identity),
    );
    number = pulls.find(matches)?.number;
  }
  if (!number) return null;
  const pull = await read(userId, `/repos/${task.repository.name}/pulls/${number}`, details);
  if (!matches(pull)) return null;
  return {
    number: pull.number,
    state: pull.merged
      ? "merged"
      : pull.state === "closed"
        ? "closed"
        : pull.draft
          ? "draft"
          : "open",
    additions: pull.additions,
    deletions: pull.deletions,
  };
}
