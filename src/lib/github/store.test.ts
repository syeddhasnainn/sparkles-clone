import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createGitHubStore } from "./store";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('test'); } }",
    compatibilityDate: "2026-09-06",
    d1Databases: ["DB"],
  }),
);

const database = await runtime.getD1Database("DB");
const {
  consumeOAuthState,
  deleteConnection,
  lockConnection,
  readConnection,
  refreshConnection,
  saveConnection,
  saveOAuthState,
} = createGitHubStore(database);

beforeAll(async () => {
  const migration = await readFile(
    new URL("../../../migrations/0001_github_connections.sql", import.meta.url),
    "utf8",
  );

  for (const statement of migration.split(";").filter((sql) => sql.trim())) {
    await database.prepare(statement).run();
  }
});

beforeEach(async () => {
  vi.restoreAllMocks();

  await database.prepare("DELETE FROM github_connections").run();
  await database.prepare("DELETE FROM github_oauth_states").run();
});

afterAll(() => runtime.dispose());

function connection(userId: string, connectionId = "original") {
  return {
    user_id: userId,
    connection_id: connectionId,
    github_user_id: 1,
    login: "octocat",
    avatar_url: "https://github.com/avatar.png",
    credentials: "encrypted",
    expires_at: Date.now() + 10_000,
    refresh_expires_at: Date.now() + 20_000,
    connected_at: Date.now(),
  };
}

describe("GitHub SQL authorization and concurrency", () => {
  it("consumes OAuth state once and only for its originating user and session", async () => {
    await saveOAuthState("state", "user-a", "session-a", "encrypted-verifier");

    expect(await consumeOAuthState("state", "user-b", "session-a")).toBeNull();
    expect(await consumeOAuthState("state", "user-a", "session-b")).toBeNull();
    expect(await consumeOAuthState("state", "user-a", "session-a")).toEqual({
      verifier: "encrypted-verifier",
    });
    expect(await consumeOAuthState("state", "user-a", "session-a")).toBeNull();
  });

  it("rejects expired state and replaces previous flows for the same session", async () => {
    await saveOAuthState("old", "user-a", "session-a", "old-verifier");
    await saveOAuthState("new", "user-a", "session-a", "new-verifier");

    expect(await consumeOAuthState("old", "user-a", "session-a")).toBeNull();

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 601_000);

    expect(await consumeOAuthState("new", "user-a", "session-a")).toBeNull();
  });

  it("isolates connection reads and allows only one token refresh lock", async () => {
    await saveConnection(connection("user-a"));

    expect(await readConnection("user-b")).toBeNull();

    const row = (await readConnection("user-a"))!;

    expect(await lockConnection(row, "first")).toBe(true);
    expect(await lockConnection(row, "second")).toBe(false);
  });

  it("prevents an old refresh from overwriting a replacement connection", async () => {
    await saveConnection(connection("user-a"));

    const row = (await readConnection("user-a"))!;

    await lockConnection(row, "lock");
    await saveConnection(connection("user-a", "replacement"));

    expect(await refreshConnection(row, "lock", "stale-credentials", 1, 2)).toBe(false);
    expect((await readConnection("user-a"))?.connection_id).toBe("replacement");
  });

  it("cannot recreate a disconnected connection through a stale refresh", async () => {
    await saveConnection(connection("user-a"));

    const row = (await readConnection("user-a"))!;

    await lockConnection(row, "lock");
    await deleteConnection(row, "lock");

    expect(await refreshConnection(row, "lock", "stale-credentials", 1, 2)).toBe(false);
    expect(await readConnection("user-a")).toBeNull();
  });
});
