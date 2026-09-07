import { z } from "zod";
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
  for (const migration of [
    "0002_agent_sessions.sql",
    "0003_model_gateway.sql",
    "0004_chatgpt_connections.sql",
  ]) {
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
    expect(
      JSON.parse(
        z.object({ OPENCODE_CONFIG_CONTENT: z.string() }).parse(agent).OPENCODE_CONFIG_CONTENT,
      ).provider.openrouter.options.baseURL,
    ).toBe(gateway.url);
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

describe("ChatGPT subscription gateway", () => {
  const key = "c".repeat(64);
  const prepare = async () => {
    const { encrypt } = await import("../github/crypto");
    await db.prepare("DELETE FROM chatgpt_connections").run();
    await db
      .prepare(
        "INSERT INTO chatgpt_connections(user_id, id, account_id, credential, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(
        owner.userId,
        "connection-a",
        "chatgpt-account",
        await encrypt(
          JSON.stringify({ access: "private-chatgpt-access", refresh: "private-chatgpt-refresh" }),
          key,
          `chatgpt:${owner.userId}:connection-a`,
        ),
        Date.now() + 3600000,
      )
      .run();
    await db
      .prepare("UPDATE agent_sessions SET selection = ? WHERE task_id = ?")
      .bind(JSON.stringify({ agent: "codex", provider: "chatgpt", model: "gpt-5.4" }), owner.taskId)
      .run();
    return issueModelGateway(
      db,
      owner.taskId,
      owner.runId,
      "https://gateway.example",
      "openrouter/anthropic/claude-sonnet-4",
      async () => "connection-a",
    );
  };
  const responseRequest = (token: string) =>
    new Request("https://gateway.example/api/model/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        input: [{ role: "user", content: "Hello" }],
        max_output_tokens: 500,
        store: true,
        stream: true,
      }),
    });
  it("routes native Responses to the pinned ChatGPT account without handing credentials to the runner", async () => {
    const grant = await prepare();
    expect(grant.agent).toBe("codex");
    expect(JSON.stringify(createAgentEnvironment(grant))).not.toContain("private-chatgpt");
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response("data: test\n\n"));
    const result = await modelGateway(
      responseRequest(grant.token),
      { ...environment, CHATGPT_TOKEN_ENCRYPTION_KEY: key },
      upstream,
    );
    expect(result.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer private-chatgpt-access");
    expect(new Headers(init?.headers).get("ChatGPT-Account-Id")).toBe("chatgpt-account");
    const body = JSON.parse(String(init?.body));
    expect(body.store).toBe(false);
    expect(body).not.toHaveProperty("max_output_tokens");
    expect(
      (
        await modelGateway(
          request(grant.token),
          { ...environment, CHATGPT_TOKEN_ENCRYPTION_KEY: key },
          upstream,
        )
      ).status,
    ).toBe(400);
  });
  it("sends subscription requests through the authenticated Node bridge by default", async () => {
    const grant = await prepare();
    const transport = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("data: test\n\n"));
    try {
      const result = await modelGateway(responseRequest(grant.token), {
        ...environment,
        CHATGPT_TOKEN_ENCRYPTION_KEY: key,
        LOCAL_MODAL_BRIDGE_URL: "http://127.0.0.1:4567",
        LOCAL_MODAL_BRIDGE_TOKEN: "private-bridge-token",
      });
      expect(result.status).toBe(200);
      const [url, options] = transport.mock.calls[0];
      expect(url).toBe("http://127.0.0.1:4567/chatgpt/responses");
      const headers = new Headers(options?.headers);
      expect(headers.get("Authorization")).toBe("Bearer private-bridge-token");
      expect(headers.get("X-Sparkles-ChatGPT-Authorization")).toBe("Bearer private-chatgpt-access");
      expect(headers.get("ChatGPT-Account-Id")).toBe("chatgpt-account");
    } finally {
      transport.mockRestore();
    }
  });
  it("preserves ChatGPT rejections so Codex does not retry them as gateway outages", async () => {
    const grant = await prepare();
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("private provider body", {
        status: 403,
        headers: { "Content-Type": "text/html" },
      }),
    );
    const result = await modelGateway(
      responseRequest(grant.token),
      { ...environment, CHATGPT_TOKEN_ENCRYPTION_KEY: key },
      upstream,
    );
    expect(result.status).toBe(403);
    const text = await result.text();
    expect(text).toContain("OpenAI rejected the connection (403)");
    expect(text).not.toContain("private provider body");
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("rejects disconnected accounts and never falls back to the application API key", async () => {
    const grant = await prepare();
    await db.prepare("DELETE FROM chatgpt_connections").run();
    const upstream = vi.fn<typeof fetch>();
    const result = await modelGateway(
      responseRequest(grant.token),
      { ...environment, CHATGPT_TOKEN_ENCRYPTION_KEY: key },
      upstream,
    );
    expect(result.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("does not switch a resumed task to a replacement connection", async () => {
    await prepare();
    await expect(
      issueModelGateway(
        db,
        owner.taskId,
        owner.runId,
        "https://gateway.example",
        "openrouter/test",
        async () => "connection-b",
      ),
    ).rejects.toThrow("disconnected ChatGPT connection");
  });
});
