import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createBridgeServer } from "./server";

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
