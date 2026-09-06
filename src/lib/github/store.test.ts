import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQLInputValue } from "node:sqlite";

vi.mock("cloudflare:workers", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFile } = await import("node:fs/promises");
  const database = new DatabaseSync(":memory:");

  database.exec(
    await readFile(
      new URL("../../../migrations/0001_github_connections.sql", import.meta.url),
      "utf8",
    ),
  );

  function prepare(sql: string) {
    let values: SQLInputValue[] = [];

    return {
      bind(...inputs: SQLInputValue[]) {
        values = inputs;

        return this;
      },
      async first() {
        return database.prepare(sql).get(...values) ?? null;
      },
      async run() {
        const result = database.prepare(sql).run(...values);

        return { meta: { changes: Number(result.changes) } };
      },
    };
  }

  return {
    env: {
      DB: {
        prepare,
        async batch(statements: { run: () => Promise<unknown> }[]) {
          database.exec("BEGIN");

          try {
            const results = [];

            for (const statement of statements) results.push(await statement.run());
            database.exec("COMMIT");

            return results;
          } catch (error) {
            database.exec("ROLLBACK");
            throw error;
          }
        },
      },
    },
  };
});

import { env } from "cloudflare:workers";
import {
  consumeOAuthState,
  deleteConnection,
  lockConnection,
  readConnection,
  refreshConnection,
  saveConnection,
  saveOAuthState,
} from "./store.server";

beforeEach(async () => {
  vi.restoreAllMocks();
  await env.DB.prepare("DELETE FROM github_connections").run();
  await env.DB.prepare("DELETE FROM github_oauth_states").run();
});

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
