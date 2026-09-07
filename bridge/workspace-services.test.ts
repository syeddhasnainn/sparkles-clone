import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer, request } from "node:http";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { workspaceServicesSource } from "./workspace-services-source";

let root: string;
let child: ChildProcess;
let control: number;
let preview: number;
let desktop: number;
let upstreamPort: number;
let staticCommand: string;
const upstream = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.end(
    JSON.stringify({
      path: request.url,
      cookie: request.headers.cookie,
      authorization: request.headers.authorization,
    }),
  );
});
upstream.on("upgrade", (request, socket) => {
  const accept = createHash("sha1")
    .update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
      accept +
      "\r\n\r\n",
  );
  socket.on("data", (chunk) => socket.write(chunk));
  socket.on("error", () => {});
  socket.on("end", () => socket.end());
});
async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = z.object({ port: z.number() }).parse(server.address()).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
function command(input: Record<string, string | number>) {
  return fetch(`http://127.0.0.1:${control}`, { method: "POST", body: JSON.stringify(input) });
}
async function ticket(expiresAt = Date.now() + 60000) {
  const response = await command({
    kind: "connect",
    service: "preview",
    expiresAt,
    parentOrigin: "https://app.example",
  });
  return z.object({ token: z.string() }).parse(await response.json()).token;
}
async function exchange(token: string, port = preview) {
  return fetch(`http://127.0.0.1:${port}/__sparkles_session`, {
    method: "POST",
    headers: { Origin: "https://app.example" },
    body: JSON.stringify({ token }),
  });
}
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "sparkles-services-"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "index.html"), "<h1>Preview test</h1>");
  writeFileSync(join(root, "services.mjs"), workspaceServicesSource);
  [control, preview, desktop] = await Promise.all([
    availablePort(),
    availablePort(),
    availablePort(),
  ]);
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  upstreamPort = z.object({ port: z.number() }).parse(upstream.address()).port;
  child = spawn(process.execPath, [join(root, "services.mjs")], {
    env: {
      ...process.env,
      DEMO_PROJECT_VALUE: "preview-env-check",
      SPARKLES_MODEL_GATEWAY_TOKEN: "must-not-inherit",
      SPARKLES_PROJECT_ENV_NAMES: JSON.stringify(["DEMO_PROJECT_VALUE"]),
      SPARKLES_WORKSPACE_DIR: root,
      SPARKLES_VIEWS_CONTROL_PORT: String(control),
      SPARKLES_PREVIEW_GATEWAY_PORT: String(preview),
      SPARKLES_DESKTOP_GATEWAY_PORT: String(desktop),
    },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await command({ kind: "services" })).ok) break;
    } catch {
      /* Wait for the subprocess listener. */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const initial = await command({ kind: "services" });
  staticCommand = z
    .object({ preview: z.object({ command: z.string() }) })
    .parse(await initial.json()).preview.command;
  const response = await command({ kind: "preview-start", command: "unused", port: upstreamPort });
  expect(response.ok).toBe(true);
}, 10000);
afterAll(async () => {
  child?.kill();
  upstream.closeAllConnections();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

it("registers a preview title without restarting an already attached app", async () => {
  const response = await command({
    kind: "preview-start",
    command: "unused",
    port: upstreamPort,
    title: "Sparkles dev server",
  });
  expect(await response.json()).toMatchObject({
    preview: { title: "Sparkles dev server", status: "ready", managed: false },
  });
  expect(JSON.parse(readFileSync(join(root, ".git/sparkles/preview.json"), "utf8"))).toMatchObject({
    title: "Sparkles dev server",
    port: upstreamPort,
  });
});

it("protects the tunnel and issues one-time partitioned sessions", async () => {
  expect((await fetch(`http://127.0.0.1:${preview}/`)).status).toBe(403);
  const token = await ticket();
  const response = await exchange(token);
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie");
  expect(cookie).toContain("HttpOnly; Secure; SameSite=None; Partitioned");
  expect((await exchange(token)).status).toBe(403);
  const page = await fetch(`http://127.0.0.1:${preview}/nested?asset=1`, {
    headers: { Cookie: cookie!.split(";")[0] + "; app-cookie=kept", Authorization: "secret" },
  });
  expect(await page.json()).toEqual({ path: "/nested?asset=1", cookie: "app-cookie=kept" });
});

it("rejects expired grants, cross-service grants, and unrelated origins", async () => {
  expect((await exchange(await ticket(Date.now() - 1))).status).toBe(403);
  expect((await exchange(await ticket(), desktop)).status).toBe(403);
  const response = await exchange(await ticket());
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  expect(
    (
      await fetch(`http://127.0.0.1:${preview}/`, {
        headers: { Cookie: cookie, Origin: "https://unrelated.example" },
      })
    ).status,
  ).toBe(403);
  await command({ kind: "revoke" });
  expect(
    (await fetch(`http://127.0.0.1:${preview}/`, { headers: { Cookie: cookie } })).status,
  ).toBe(403);
});

it("forwards upgraded connections and disconnecting revokes existing access", async () => {
  const response = await exchange(await ticket());
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const socket = await new Promise<import("node:stream").Duplex>((resolve, reject) => {
    const upgrade = request({
      hostname: "127.0.0.1",
      port: preview,
      path: "/hmr",
      headers: {
        Cookie: cookie,
        Origin: "https://app.example",
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    });
    upgrade.on("upgrade", (_, socket) => resolve(socket));
    upgrade.on("error", reject);
    upgrade.on("response", () => reject(new Error("Upgrade rejected")));
    upgrade.end();
  });
  const echoed = new Promise<Buffer>((resolve) => socket.once("data", resolve));
  socket.write(Buffer.from([0x81, 0x02, 0x6f, 0x6b]));
  expect(await echoed).toEqual(Buffer.from([0x81, 0x02, 0x6f, 0x6b]));
  const closed = new Promise<void>((resolve) => socket.once("close", resolve));
  await command({ kind: "preview-stop" });
  await closed;
  expect(
    (await fetch(`http://127.0.0.1:${preview}/`, { headers: { Cookie: cookie } })).status,
  ).toBe(403);
  expect((await fetch(`http://127.0.0.1:${upstreamPort}/`)).ok).toBe(true);
  await command({ kind: "preview-start", command: "unused", port: upstreamPort });
});

it("rejects internal ports and unsafe preview paths", async () => {
  const path = await command({
    kind: "connect",
    service: "preview",
    expiresAt: Date.now() + 60000,
    parentOrigin: "https://app.example",
    path: "//other.example",
  });
  expect(path.status).toBe(400);
  await command({ kind: "preview-stop" });
  expect((await command({ kind: "preview-start", command: "unused", port: control })).status).toBe(
    400,
  );
});

it("returns 400 for malformed unauthenticated URLs without stopping either gateway", async () => {
  for (const port of [preview, desktop]) {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const invalid = request({ hostname: "127.0.0.1", port, path: "//[" }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      invalid.on("error", reject);
      invalid.end();
    });
    expect(status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(403);
  }
  expect((await command({ kind: "services" })).ok).toBe(true);
});

it("serves public static assets but denies private files, encoded paths, and symlinks", async () => {
  const outside = mkdtempSync(join(tmpdir(), "sparkles-static-outside-"));
  try {
    writeFileSync(join(root, "index.html"), "<h1>Public page</h1>");
    writeFileSync(join(root, "app.js"), "console.log('public asset')");
    writeFileSync(join(root, ".env"), "synthetic secret");
    writeFileSync(join(root, ".git", "secret.txt"), "synthetic secret");
    writeFileSync(join(outside, "secret.txt"), "synthetic outside secret");
    symlinkSync(outside, join(root, "escape"));
    symlinkSync(".git", join(root, "alias"));
    symlinkSync(".env", join(root, "public.txt"));
    await command({ kind: "preview-stop" });
    await command({ kind: "preview-start", command: staticCommand, port: await availablePort() });
    for (let attempt = 0; attempt < 50; attempt++) {
      const state = await command({ kind: "services" });
      const result = z
        .object({ preview: z.object({ status: z.string() }) })
        .parse(await state.json());
      if (result.preview.status === "ready") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const session = await exchange(await ticket());
    const headers = { Cookie: session.headers.get("set-cookie")!.split(";")[0] };
    expect(await (await fetch(`http://127.0.0.1:${preview}/`, { headers })).text()).toBe(
      "<h1>Public page</h1>",
    );
    expect((await fetch(`http://127.0.0.1:${preview}/app.js`, { headers })).status).toBe(200);
    for (const path of [
      "/.env",
      "/%2eenv",
      "/.git/secret.txt",
      "/alias/secret.txt",
      "/escape/secret.txt",
      "/public.txt",
      "/%2e%2e%2fsecret.txt",
    ]) {
      expect((await fetch(`http://127.0.0.1:${preview}${path}`, { headers })).status, path).toBe(
        404,
      );
    }
  } finally {
    await command({ kind: "preview-stop" });
    rmSync(outside, { recursive: true, force: true });
  }
});

it("starts one preview process for concurrent requests and passes only project variables", async () => {
  await command({ kind: "preview-stop" });
  const port = await availablePort();
  writeFileSync(
    join(root, "env-preview.cjs"),
    String.raw`
    const fs = require('node:fs');
    fs.appendFileSync('launch-count.txt', 'started\n');
    require('node:http').createServer((request, response) => {
      response.end(JSON.stringify({project: process.env.DEMO_PROJECT_VALUE === 'preview-env-check', gatewayAbsent: !process.env.SPARKLES_MODEL_GATEWAY_TOKEN}));
    }).listen(Number(process.env.PORT), '127.0.0.1');
  `,
  );
  const input = { kind: "preview-start", command: "node env-preview.cjs", port };
  const responses = await Promise.all([command(input), command(input)]);
  expect(responses.every((response) => response.ok)).toBe(true);
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`);
      expect(await response.json()).toEqual({ project: true, gatewayAbsent: true });
      break;
    } catch (error) {
      if (attempt === 49) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  expect(readFileSync(join(root, "launch-count.txt"), "utf8")).toBe("started\n");
  await command({ kind: "preview-stop" });
  expect(await (await command({ kind: "services" })).json()).toMatchObject({
    preview: { status: "stopped" },
  });
});
