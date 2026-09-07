import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createBridgeServer } from "./server";
import { bridgeProtocolVersion, requireBridgeCompatibility } from "./protocol";

const execute = vi.fn(async () => ({ running: false, sandboxId: null, commit: null }));
const server = createBridgeServer({ execute }, "test-access-token");
let url: string;
const body = JSON.stringify({ action: "status", name: `sparkles-${crypto.randomUUID()}` });

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = z.object({ port: z.number() }).parse(server.address());
  url = `http://127.0.0.1:${address.port}/workspace`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("local bridge access", () => {
  it("reports compatibility only to authenticated callers", async () => {
    const endpoint = new URL("/capabilities", url);
    expect((await fetch(endpoint, { method: "POST" })).status).toBe(403);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer test-access-token" },
    });
    expect(await response.clone().json()).toEqual({ version: bridgeProtocolVersion });
    await expect(requireBridgeCompatibility(response)).resolves.toBeUndefined();
  });

  it("rejects requests without the development token", async () => {
    const response = await fetch(url, { method: "POST", body });
    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects browser origins even with a valid token", async () => {
    const response = await fetch(url, {
      method: "POST",
      body,
      headers: { Authorization: "Bearer test-access-token", Origin: "https://example.com" },
    });
    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepts authenticated Worker requests", async () => {
    const response = await fetch(url, {
      method: "POST",
      body,
      headers: { Authorization: "Bearer test-access-token" },
    });
    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledOnce();
  });
});

describe("ChatGPT relay", () => {
  const upstream = vi.fn<typeof fetch>();
  const relay = createBridgeServer({ execute }, "relay-token", upstream);
  let relayUrl: string;
  const headers = {
    Authorization: "Bearer relay-token",
    "X-Sparkles-ChatGPT-Authorization": "Bearer private-chatgpt-token",
    "ChatGPT-Account-Id": "account-a",
    "Content-Type": "application/json",
    "cf-worker": "worker.example.com",
    Cookie: "untrusted=cookie",
  };

  beforeAll(async () => {
    await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
    relayUrl = `http://127.0.0.1:${z.object({ port: z.number() }).parse(relay.address()).port}/chatgpt/responses`;
  });

  afterAll(async () => {
    relay.closeAllConnections();
    await new Promise<void>((resolve) => relay.close(() => resolve()));
  });

  it("requires bridge authentication before contacting ChatGPT", async () => {
    const response = await fetch(relayUrl, { method: "POST", body: "{}" });
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("removes Worker headers and streams without waiting for completion", async () => {
    let cancelled = false;
    upstream.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"type":"response.created"}\n\n'));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "Content-Type": "text/event-stream", "Set-Cookie": "private=value" } },
      ),
    );
    const response = await fetch(relayUrl, { method: "POST", headers, body: '{"model":"test"}' });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("response.created");
    expect(response.headers.get("set-cookie")).toBeNull();
    const [target, options] = upstream.mock.calls.at(-1)!;
    expect(target).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(Object.fromEntries(new Headers(options?.headers))).toEqual({
      authorization: "Bearer private-chatgpt-token",
      "chatgpt-account-id": "account-a",
      "content-type": "application/json",
    });
    expect(options?.redirect).toBe("manual");
    await reader.cancel();
    await vi.waitFor(() => expect(options?.signal?.aborted).toBe(true));
    await vi.waitFor(() => expect(cancelled).toBe(true));
  });

  it("preserves authentication and quota failures without following redirects", async () => {
    for (const status of [401, 403, 429, 307]) {
      upstream.mockResolvedValueOnce(new Response("provider error", { status }));
      const response = await fetch(relayUrl, {
        method: "POST",
        headers,
        body: "{}",
        redirect: "manual",
      });
      expect(response.status).toBe(status);
      expect(await response.text()).toBe("provider error");
    }
  });
});
