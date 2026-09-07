import { expect, it } from "vitest";
import { z } from "zod";
import { readTaskPullRequest } from "./pull-request";
import type { Workspace } from "../../../bridge/contracts";

const task: Workspace = {
  id: "task-a",
  prompt: "Change the sidebar",
  repository: { id: 42, installationId: 1, name: "owner/repo", defaultBranch: "main" },
  status: "stopped",
  createdAt: 1,
  expiresAt: 2,
  sandboxId: null,
  commit: null,
  error: null,
};
const pull = {
  number: 22,
  head: { ref: "sparkles/task-a", repo: { id: 42 } },
  base: { repo: { id: 42 } },
  state: "open",
  draft: false,
  merged: false,
  additions: 8,
  deletions: 31,
};

it("finds the PR for the exact task branch and repository, including closed PRs", async () => {
  const paths: string[] = [];
  async function read<T>(userId: string, path: string, schema: z.ZodType<T>): Promise<T> {
    expect(userId).toBe("user-a");
    paths.push(path);
    return schema.parse(path.includes("?") ? [pull] : pull);
  }
  expect(await readTaskPullRequest(read, "user-a", task)).toEqual({
    number: 22,
    state: "open",
    additions: 8,
    deletions: 31,
  });
  const query = new URL(`https://api.github.com${paths[0]}`).searchParams;
  expect(query.get("head")).toBe("owner:sparkles/task-a");
  expect(query.get("state")).toBe("all");
  expect(paths[1]).toBe("/repos/owner/repo/pulls/22");
});

it.each([
  [{ ...pull, head: { ref: "another-task", repo: { id: 42 } } }],
  [{ ...pull, head: { ref: "sparkles/task-a", repo: { id: 99 } } }],
  [{ ...pull, base: { repo: { id: 99 } } }],
])("ignores a PR for a different branch or repository", async (other) => {
  async function read<T>(_user: string, _path: string, schema: z.ZodType<T>): Promise<T> {
    return schema.parse([other]);
  }
  expect(await readTaskPullRequest(read, "user-a", task)).toBeNull();
});

it.each([
  ["open", true, false, "draft"],
  ["closed", false, false, "closed"],
  ["closed", false, true, "merged"],
])("distinguishes %s draft=%s merged=%s", async (state, draft, merged, expected) => {
  async function read<T>(_user: string, path: string, schema: z.ZodType<T>): Promise<T> {
    expect(path).toBe("/repos/owner/repo/pulls/22");
    return schema.parse({ ...pull, state, draft, merged });
  }
  expect(
    await readTaskPullRequest(read, "user-a", task, {
      number: 22,
      state: "open",
      additions: 0,
      deletions: 0,
    }),
  ).toMatchObject({ state: expected });
});
