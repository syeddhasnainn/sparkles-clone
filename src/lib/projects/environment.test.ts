import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { parseEnvironmentFile } from "./dotenv";
import { createProjectEnvironmentStore } from "./store";
import { environmentVariablesSchema } from "../../../bridge/project-environment";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('test'); } }",
    compatibilityDate: "2026-09-06",
    d1Databases: ["DB"],
  }),
);
const database = await runtime.getD1Database("DB");
const store = createProjectEnvironmentStore(database, "ad".repeat(32));
const repository = { id: 1, installationId: 2, name: "owner/project", defaultBranch: "main" };

beforeAll(async () => {
  const sql = await readFile(
    new URL("../../../migrations/0005_project_environments.sql", import.meta.url),
    "utf8",
  );
  for (const statement of sql.split(";").filter((value) => value.trim()))
    await database.prepare(statement).run();
});
afterAll(() => runtime.dispose());

describe("project environment", () => {
  it("imports quotes, empty values, comments and duplicate assignments without expansion", () => {
    expect(
      parseEnvironmentFile(
        '# comment\nexport A="first"\nB=\nA="last\\nline" # comment\nC=\'${A}#literal\'',
      ),
    ).toEqual([
      { name: "A", value: "last\nline" },
      { name: "B", value: "" },
      { name: "C", value: "${A}#literal" },
    ]);
    expect(() => parseEnvironmentFile('A="unfinished')).toThrow("Close");
    expect(() => parseEnvironmentFile("invalid line")).toThrow("NAME=value");
  });

  it("rejects runtime overrides, duplicate names and oversized or null values", () => {
    for (const name of [
      "PATH",
      "NODE_OPTIONS",
      "SPARKLES_AGENT_TOKEN",
      "MODAL_TASK_ID",
      "OPENAI_API_KEY",
    ]) {
      expect(environmentVariablesSchema.safeParse([{ name, value: "value" }]).success).toBe(false);
    }
    for (const value of ["a\0b", "é".repeat(8192)]) {
      expect(environmentVariablesSchema.safeParse([{ name: "APP_VALUE", value }]).success).toBe(
        false,
      );
    }
    expect(
      environmentVariablesSchema.safeParse([
        { name: "A", value: "1" },
        { name: " A ", value: "2" },
      ]).success,
    ).toBe(false);
  });

  it("allows app credentials while preserving the agent gateway namespace", () => {
    expect(
      environmentVariablesSchema.safeParse([
        { name: "MODAL_TOKEN_ID", value: "test-id" },
        { name: "MODAL_TOKEN_SECRET", value: "test-secret" },
        { name: "OPENROUTER_API_KEY", value: "test-key" },
      ]).success,
    ).toBe(true);
    expect(
      environmentVariablesSchema.safeParse([
        { name: "SPARKLES_MODEL_GATEWAY_TOKEN", value: "override" },
      ]).success,
    ).toBe(false);
  });

  it("encrypts values, isolates owners and repositories, and rejects stale saves", async () => {
    const variables = [
      { name: "DATABASE_URL", value: "private-test-value" },
      { name: "EMPTY", value: "" },
    ];
    await store.save("alice", repository, variables, 0);
    expect(await store.read("alice", 1)).toEqual({ variables, revision: 1 });
    expect(await store.read("bob", 1)).toEqual({ variables: [], revision: 0 });
    expect(await store.read("alice", 2)).toEqual({ variables: [], revision: 0 });
    const stored = await database
      .prepare("SELECT variables FROM project_environments WHERE user_id = ?")
      .bind("alice")
      .first<{ variables: string }>();
    expect(stored?.variables).not.toContain("private-test-value");
    expect(JSON.stringify(await store.list("alice"))).not.toContain("private-test-value");
    await expect(store.save("alice", repository, [], 0)).rejects.toThrow("another tab");
    await store.save("alice", repository, [], 1);
    expect(await store.read("alice", 1)).toEqual({ variables: [], revision: 2 });
    await expect(store.save("alice", repository, variables, 1)).rejects.toThrow("another tab");
    await database
      .prepare("UPDATE project_environments SET user_id = ? WHERE user_id = ?")
      .bind("bob", "alice")
      .run();
    await expect(store.read("bob", 1)).rejects.toThrow();
  });
});
