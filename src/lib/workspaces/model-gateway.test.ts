import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { issueModelGateway, modelGateway, revokeModelGateway } from "./model-gateway";
import { createSessionStore } from "./session-store";
import { createAgentEnvironment } from "../../../bridge/agent-environment";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('test'); } }",
    compatibilityDate: "2026-09-06",
    d1Databases: ["DB"],
  }),
);
const { DB: db } = await runtime.getBindings<{ DB: D1Database }>();
const sessions = createSessionStore(db);
const owner = { taskId: "task-a", userId: "user-a", runId: "run-a" };
const environment = { DB: db, OPENROUTER_API_KEY: "private-provider-key-for-tests" };
const issue = () =>
  issueModelGateway(
    db,
    owner.taskId,
    owner.runId,
    "https://gateway.example",
    "openrouter/anthropic/claude-sonnet-4",
  );
const request = (token: string, extra = {}) =>
  new Request("https://gateway.example/api/model/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
      ...extra,
    }),
  });
beforeAll(async () => {
  for (const migration of ["0002_agent_sessions.sql", "0003_model_gateway.sql"]) {
    const sql = await readFile(
      new URL(`../../../migrations/${migration}`, import.meta.url),
      "utf8",
    );
    for (const statement of sql.split(";").filter((statement) => statement.trim()))
      await db.prepare(statement).run();
  }
});
beforeEach(async () => {
  await db.prepare("DELETE FROM agent_sessions").run();
  await sessions.ensure(owner);
});
afterAll(() => runtime.dispose());

describe("model gateway", () => {
  it("keeps provider credentials outside the sandbox and stores only token hashes", async () => {
    const gateway = await issue();
    const agent = createAgentEnvironment(gateway);
    expect(JSON.stringify(agent)).not.toContain(environment.OPENROUTER_API_KEY);
    expect(agent).not.toHaveProperty("OPENROUTER_API_KEY");
    expect(JSON.parse(agent.OPENCODE_CONFIG_CONTENT).provider.openrouter.options.baseURL).toBe(
      gateway.url,
    );
    const rows = await db.prepare("SELECT * FROM model_gateway_tokens").all();
    expect(JSON.stringify(rows)).not.toContain(gateway.token);
  });
  it("replaces authorization, fixes the destination, and streams before the upstream completes", async () => {
    const gateway = await issue();
    const calls: Request[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'));
      },
    });
    const fetchUpstream = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      calls.push(new Request(input, init));
      return new Response(stream, {
        headers: {
          "Set-Cookie": "private=true",
          "x-provider-debug": environment.OPENROUTER_API_KEY,
        },
      });
    });
    const response = await modelGateway(request(gateway.token), environment, fetchUpstream);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("data:");
    await reader.cancel();
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${environment.OPENROUTER_API_KEY}`);
    expect(calls[0].redirect).toBe("manual");
    expect(JSON.stringify([...response.headers])).not.toContain(environment.OPENROUTER_API_KEY);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("rejects unknown, expired, revoked, and previous-run tokens before contacting the provider", async () => {
    const fetchUpstream = vi.fn<typeof fetch>();
    expect(
      (
        await modelGateway(
          request(`${crypto.randomUUID()}${crypto.randomUUID()}`),
          environment,
          fetchUpstream,
        )
      ).status,
    ).toBe(401);
    let gateway = await issue();
    await db.prepare("UPDATE model_gateway_tokens SET expires_at = 1").run();
    expect((await modelGateway(request(gateway.token), environment, fetchUpstream)).status).toBe(
      401,
    );
    gateway = await issue();
    await revokeModelGateway(db, owner.runId);
    expect((await modelGateway(request(gateway.token), environment, fetchUpstream)).status).toBe(
      401,
    );
    gateway = await issue();
    await sessions.beginRun({ ...owner, runId: "run-b" });
    expect((await modelGateway(request(gateway.token), environment, fetchUpstream)).status).toBe(
      401,
    );
    expect(fetchUpstream).not.toHaveBeenCalled();
  });
  it("rejects a stopped session and does not mint credentials for a different task or run", async () => {
    const gateway = await issue();
    await sessions.finish(owner, false);
    const fetchUpstream = vi.fn<typeof fetch>();
    expect((await modelGateway(request(gateway.token), environment, fetchUpstream)).status).toBe(
      401,
    );
    await expect(issue()).rejects.toThrow("inactive");
    await expect(
      issueModelGateway(
        db,
        "task-b",
        owner.runId,
        "https://gateway.example",
        "openrouter/test/model",
      ),
    ).rejects.toThrow("inactive");
    expect(fetchUpstream).not.toHaveBeenCalled();
  });
  it("rejects browser calls, other endpoints, and model routing overrides", async () => {
    const gateway = await issue();
    const fetchUpstream = vi.fn<typeof fetch>();
    const browser = request(gateway.token);
    browser.headers.set("Origin", "https://attacker.example");
    expect((await modelGateway(browser, environment, fetchUpstream)).status).toBe(403);
    expect(
      (
        await modelGateway(
          new Request("https://gateway.example/api/model/keys", request(gateway.token)),
          environment,
          fetchUpstream,
        )
      ).status,
    ).toBe(404);
    for (const override of [
      { model: "another/model" },
      { models: ["another/model"] },
      { provider: { order: ["x"] } },
    ]) {
      expect(
        (await modelGateway(request(gateway.token, override), environment, fetchUpstream)).status,
      ).toBe(400);
    }
    expect(fetchUpstream).not.toHaveBeenCalled();
  });
  it("does not relay upstream error bodies or exception details", async () => {
    const gateway = await issue();
    const fetchUpstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(environment.OPENROUTER_API_KEY, { status: 401 }));
    const response = await modelGateway(request(gateway.token), environment, fetchUpstream);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(environment.OPENROUTER_API_KEY);
    fetchUpstream.mockRejectedValue(new Error(environment.OPENROUTER_API_KEY));
    expect(
      await (await modelGateway(request(gateway.token), environment, fetchUpstream)).text(),
    ).not.toContain(environment.OPENROUTER_API_KEY);
  });
});
