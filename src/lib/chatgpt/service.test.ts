import { z } from "zod";
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
import { createChatGPTService } from "./service";
import { createChatGPTAPI, tokenIdentity } from "./api";
import { requireChatGPTModel } from "./models";
import { createAgentEnvironment } from "../../../bridge/agent-environment";
import { agentSelectionSchema } from "../../../bridge/agent-selection";
import { decrypt } from "../github/crypto";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-09-06",
    d1Databases: ["DB"],
  }),
);
const { DB: db } = await runtime.getBindings<{ DB: D1Database }>();
const key = "b".repeat(64);
const jwt = (account = "account-a") =>
  `header.${btoa(JSON.stringify({ email: "person@example.com", "https://api.openai.com/auth": { chatgpt_account_id: account, chatgpt_plan_type: "plus" } }))}.signature`;
const tokens = (account = "account-a") => ({
  access_token: jwt(account),
  refresh_token: "private-refresh",
  expires_in: 3600,
});
const api = {
  start: vi.fn(async () => ({
    deviceAuthId: "private-device-id",
    userCode: "ABCD-1234",
    interval: 5000,
  })),
  poll: vi.fn(async () => tokens()),
  refresh: vi.fn(async () => ({ ...tokens(), refresh_token: "rotated-refresh" })),
};
const service = () => createChatGPTService({ DB: db, CHATGPT_TOKEN_ENCRYPTION_KEY: key }, api);
const connect = async (user = "alice") => {
  const challenge = await service().start(user);
  await db
    .prepare("UPDATE chatgpt_device_authorizations SET poll_after = 0 WHERE user_id = ?")
    .bind(user)
    .run();
  await service().poll(user, challenge.id);
  return (await service().status(user)).account!;
};
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
    for (const statement of sql.split(";").filter((part) => part.trim()))
      await db.prepare(statement).run();
  }
});
beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM chatgpt_device_authorizations"),
    db.prepare("DELETE FROM chatgpt_connections"),
    db.prepare("DELETE FROM agent_sessions"),
  ]);
  vi.clearAllMocks();
  api.poll.mockImplementation(async () => tokens());
  api.refresh.mockImplementation(async () => ({ ...tokens(), refresh_token: "rotated-refresh" }));
});
afterAll(() => runtime.dispose());

describe("shared ChatGPT connections", () => {
  it("encrypts device state and credentials, exposes only display metadata, and makes polling idempotent", async () => {
    const flow = await service().start("alice");
    const pending = await db
      .prepare("SELECT state FROM chatgpt_device_authorizations")
      .first("state");
    expect(String(pending)).not.toContain("private-device-id");
    expect(flow).not.toHaveProperty("deviceAuthId");
    await db.prepare("UPDATE chatgpt_device_authorizations SET poll_after = 0").run();
    expect(await service().poll("alice", flow.id)).toEqual({ status: "connected" });
    expect(await service().poll("alice", flow.id)).toEqual({ status: "connected" });
    expect(api.poll).toHaveBeenCalledTimes(1);
    const status = await service().status("alice");
    expect(status.account).toMatchObject({
      email: "person@example.com",
      plan: "plus",
      reconnectRequired: false,
    });
    expect(JSON.stringify(status)).not.toContain("private-refresh");
    const stored = String(
      await db.prepare("SELECT credential FROM chatgpt_connections").first("credential"),
    );
    expect(stored).not.toContain("private-refresh");
    await expect(decrypt(stored, key, `chatgpt:bob:${status.account!.id}`)).rejects.toThrow();
  });
  it("fences other users, stale login attempts, expired codes, and early polling", async () => {
    const first = await service().start("alice");
    await expect(service().poll("bob", first.id)).rejects.toThrow("cancelled");
    expect(await service().poll("alice", first.id)).toEqual({ status: "pending" });
    expect(api.poll).not.toHaveBeenCalled();
    const second = await service().start("alice");
    await expect(service().poll("alice", first.id)).rejects.toThrow("cancelled");
    await db.prepare("UPDATE chatgpt_device_authorizations SET expires_at = 0").run();
    await expect(service().poll("alice", second.id)).rejects.toThrow("expired");
  });
  it("does not reconnect a different account into tasks pinned to the old identity", async () => {
    const account = await connect();
    api.poll.mockImplementation(async () => tokens("different-account"));
    const flow = await service().start("alice");
    await db.prepare("UPDATE chatgpt_device_authorizations SET poll_after = 0").run();
    await expect(service().poll("alice", flow.id)).rejects.toThrow("same ChatGPT account");
    expect((await service().status("alice")).account?.id).toBe(account.id);
  });
  it("lets both runners share one refresh and persists the rotated token", async () => {
    const account = await connect();
    await db.prepare("UPDATE chatgpt_connections SET expires_at = 0").run();
    const [openCode, codex] = await Promise.all([
      service().access("alice", account.id),
      service().access("alice", account.id),
    ]);
    expect(openCode).toEqual(codex);
    expect(api.refresh).toHaveBeenCalledTimes(1);
    const stored = String(
      await db.prepare("SELECT credential FROM chatgpt_connections").first("credential"),
    );
    expect(JSON.parse(await decrypt(stored, key, `chatgpt:alice:${account.id}`)).refresh).toBe(
      "rotated-refresh",
    );
  });
  it("rejects another user's connection and marks uncertain refresh failures for reconnection", async () => {
    const account = await connect();
    await expect(service().access("bob", account.id)).rejects.toThrow("Reconnect");
    api.refresh.mockRejectedValueOnce(new Error("sensitive provider error"));
    await expect(service().access("alice", account.id, true)).rejects.toThrow("Reconnect ChatGPT");
    expect((await service().status("alice")).account?.reconnectRequired).toBe(true);
  });
  it("does not resurrect a connection when disconnected during token refresh", async () => {
    const account = await connect();
    api.refresh.mockImplementationOnce(async () => {
      await service().disconnect("alice");
      return tokens();
    });
    await expect(service().access("alice", account.id, true)).rejects.toThrow("Reconnect");
    expect((await service().status("alice")).account).toBeNull();
  });
  it("does not finalize a cancelled device exchange", async () => {
    const flow = await service().start("alice");
    await db.prepare("UPDATE chatgpt_device_authorizations SET poll_after = 0").run();
    api.poll.mockImplementationOnce(async () => {
      await service().cancel("alice", flow.id);
      return tokens();
    });
    await expect(service().poll("alice", flow.id)).rejects.toThrow("connection changed");
    expect((await service().status("alice")).account).toBeNull();
  });
});

describe("OpenAI device API", () => {
  it("uses only fixed endpoints and exchanges the code server-side", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ device_auth_id: "secret-device", user_code: "ABCD", interval: "5" }),
      )
      .mockResolvedValueOnce(new Response("", { status: 403 }))
      .mockResolvedValueOnce(
        Response.json({ authorization_code: "code", code_verifier: "verifier" }),
      )
      .mockResolvedValueOnce(Response.json(tokens()));
    const client = createChatGPTAPI(fetcher);
    expect((await client.start()).interval).toBe(5000);
    expect(await client.poll("secret-device", "ABCD")).toBeNull();
    expect(await client.poll("secret-device", "ABCD")).toEqual(tokens());
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/auth\.openai\.com\//);
      expect(init?.redirect).toBe("manual");
    }
    expect(tokenIdentity(tokens()).accountId).toBe("account-a");
  });
  it("accepts ten-day token lifetimes during sign-in and refresh", async () => {
    const issued = { ...tokens(), expires_in: 864000 };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ authorization_code: "code", code_verifier: "verifier" }),
      )
      .mockResolvedValueOnce(Response.json(issued))
      .mockResolvedValueOnce(Response.json(issued));
    const client = createChatGPTAPI(fetcher);
    await expect(client.poll("device", "CODE")).resolves.toEqual(issued);
    await expect(client.refresh("refresh")).resolves.toEqual(issued);
  });
  it("does not leak upstream failures or accept oversized responses", async () => {
    const failed = createChatGPTAPI(
      vi.fn<typeof fetch>().mockResolvedValue(new Response("private failure", { status: 401 })),
    );
    await expect(failed.refresh("secret")).rejects.toThrow("Reconnect ChatGPT");
    const oversized = createChatGPTAPI(
      vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(150000))),
    );
    await expect(oversized.start()).rejects.toThrow("invalid response");
  });
});

describe("bundled model selection", () => {
  const environment = { DB: db, CHATGPT_TOKEN_ENCRYPTION_KEY: key };
  it("validates the bundled catalog while enforcing connection ownership", async () => {
    await connect();
    expect((await requireChatGPTModel(environment, "alice", "gpt-5.6-sol")).contextWindow).toBe(
      272000,
    );
    await expect(requireChatGPTModel(environment, "bob", "gpt-5.6-sol")).rejects.toThrow(
      "Connect ChatGPT",
    );
    await expect(requireChatGPTModel(environment, "alice", "gpt-hidden")).rejects.toThrow(
      "not supported",
    );
  });
  it("preserves reasoning selection and configures both agent runtimes", () => {
    const selection = agentSelectionSchema.parse({
      provider: "chatgpt",
      agent: "codex",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    });
    expect(selection).toHaveProperty("reasoningEffort", "high");
    const gateway = {
      provider: "chatgpt" as const,
      model: "openai/gpt-5.6-sol",
      url: "https://gateway.example/api/model",
      token: "test-token",
      reasoningEffort: "high" as const,
    };
    const codex = z
      .object({ CODEX_CONFIG: z.string() })
      .parse(createAgentEnvironment({ ...gateway, agent: "codex" }));
    expect(JSON.parse(codex.CODEX_CONFIG).model_reasoning_effort).toBe("high");
    const opencode = z
      .object({ OPENCODE_CONFIG_CONTENT: z.string() })
      .parse(createAgentEnvironment({ ...gateway, agent: "opencode" }));
    expect(
      JSON.parse(opencode.OPENCODE_CONFIG_CONTENT).provider.openai.models["gpt-5.6-sol"].options
        .reasoningEffort,
    ).toBe("high");
  });
  it("validates model IDs and registers their limits with OpenCode", () => {
    expect(
      agentSelectionSchema.parse({ agent: "codex", provider: "chatgpt", model: "gpt-future" })
        .provider,
    ).toBe("chatgpt");
    expect(
      agentSelectionSchema.safeParse({
        agent: "codex",
        provider: "chatgpt",
        model: "../other-provider",
      }).success,
    ).toBe(false);
    const config = createAgentEnvironment({
      agent: "opencode",
      provider: "chatgpt",
      model: "openai/gpt-future",
      contextWindow: 400000,
      url: "https://gateway.example/api/model",
      token: "test-token",
    });
    const parsed = JSON.parse(
      z.object({ OPENCODE_CONFIG_CONTENT: z.string() }).parse(config).OPENCODE_CONFIG_CONTENT,
    );
    expect(parsed.provider.openai.models["gpt-future"].limit.context).toBe(400000);
    expect(parsed.model).toBe("openai/gpt-future");
  });
});
