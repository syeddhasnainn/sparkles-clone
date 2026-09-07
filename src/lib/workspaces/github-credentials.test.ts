import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workspaceGitHubCredentials } from "./github-credentials";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('test'); } }",
    compatibilityDate: "2026-09-06",
    d1Databases: ["DB"],
  }),
);
const { DB: db } = await runtime.getBindings<{ DB: D1Database }>();
const repository = { id: 1, installationId: 2, name: "owner/repo", defaultBranch: "main" };
const credentials = {
  token: "secret-repository-token",
  expiresAt: Date.now() + 3600000,
  repository: repository.name,
  login: "owner",
  name: "owner",
  email: "1+owner@users.noreply.github.com",
};
const revoked: string[] = [];
const store = workspaceGitHubCredentials(
  db,
  "a".repeat(64),
  async (userId, selected) => {
    expect(userId).toBe("user");
    expect(selected).toEqual(repository);
    return credentials;
  },
  async (token) => {
    revoked.push(token);
  },
);
beforeAll(async () => {
  await db
    .prepare("CREATE TABLE agent_sessions(task_id TEXT, run_id TEXT, user_id TEXT, status TEXT)")
    .run();
  const migration = await readFile(
    new URL("../../../migrations/0007_workspace_github_credentials.sql", import.meta.url),
    "utf8",
  );
  for (const statement of migration.split(";").filter((s) => s.trim()))
    await db.prepare(statement).run();
});
beforeEach(async () => {
  revoked.length = 0;
  await db.prepare("DELETE FROM workspace_github_credentials").run();
  await db.prepare("DELETE FROM agent_sessions").run();
  await db.prepare("INSERT INTO agent_sessions VALUES ('task', 'run', 'user', 'starting')").run();
});
afterAll(() => runtime.dispose());
it("encrypts credentials at rest and revokes only the selected run", async () => {
  expect(await store.issue("task", "run", repository)).toEqual(credentials);
  const rows = await db.prepare("SELECT * FROM workspace_github_credentials").all();
  expect(JSON.stringify(rows)).not.toContain(credentials.token);
  await store.revoke("other-run");
  expect(revoked).toEqual([]);
  await store.revoke("run");
  expect(revoked).toEqual([credentials.token]);
  expect((await db.prepare("SELECT * FROM workspace_github_credentials").all()).results).toEqual(
    [],
  );
});
it("rejects a run that does not belong to the task", async () => {
  await expect(store.issue("other-task", "run", repository)).rejects.toThrow();
});
it("revokes an issued token when the run stops during authorization", async () => {
  const racingStore = workspaceGitHubCredentials(
    db,
    "a".repeat(64),
    async () => {
      await db.prepare("UPDATE agent_sessions SET status = 'stopped'").run();
      return credentials;
    },
    async (token) => {
      revoked.push(token);
    },
  );
  await expect(racingStore.issue("task", "run", repository)).rejects.toThrow("inactive");
  expect(revoked).toEqual([credentials.token]);
});
it("retains failed revocations so cleanup can retry", async () => {
  await store.issue("task", "run", repository);
  const failing = workspaceGitHubCredentials(
    db,
    "a".repeat(64),
    async () => credentials,
    async () => {
      throw new Error("offline");
    },
  );
  await expect(failing.revoke("run")).rejects.toThrow("offline");
  expect(
    (await db.prepare("SELECT * FROM workspace_github_credentials").all()).results,
  ).toHaveLength(1);
  await store.revoke("run");
  expect(revoked).toEqual([credentials.token]);
});
