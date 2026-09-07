import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { z } from "zod";
import { agentRunnerSource } from "./agent-runner-source";
import { agentSnapshotSchema } from "./contracts";
import type { RunnerCommand } from "./agent-transport";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});

it("changes native modes, preserves pending approvals, and restores the saved choice", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sparkles-permission-modes-"));
  await symlink(new URL("./node_modules", import.meta.url).pathname, join(dir, "node_modules"));
  await writeFile(join(dir, "runner.mjs"), agentRunnerSource);
  await writeFile(
    join(dir, "codex-acp"),
    `#!/usr/bin/env node
const readline = require('node:readline');
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
let mode = 'read-only';
let rejected = false;
let promptId;
const modes = () => ({ currentModeId: mode, availableModes: ['read-only', 'agent', 'agent-full-access'].map(id => ({ id, name: id })) });
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [{ id: 'gateway', name: 'Gateway' }] } });
  if (message.method === 'authenticate') send({ id: message.id, result: {} });
  if (message.method === 'session/new' || message.method === 'session/load') send({ id: message.id, result: { sessionId: 'test-session', modes: modes() } });
  if (message.method === 'session/set_mode') {
    if (message.params.sessionId !== 'test-session') throw new Error('Wrong session');
    if (message.params.modeId === 'agent' && !rejected) {
      rejected = true;
      send({ id: message.id, error: { code: -32602, message: 'Mode temporarily unavailable' } });
    } else {
      mode = message.params.modeId;
      send({ id: message.id, result: {} });
    }
  }
  if (message.method === 'session/prompt') {
    promptId = message.id;
    send({ method: 'session/update', params: { sessionId: 'test-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'mode=' + mode } } } });
    send({ id: 'approval', method: 'session/request_permission', params: { sessionId: 'test-session', toolCall: { toolCallId: 'tool-a', title: 'Run command', kind: 'execute' }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }] } });
  }
  if (message.id === 'approval' && message.result) send({ id: promptId, result: { stopReason: 'end_turn' } });
});
`,
    { mode: 0o700 },
  );
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const { port } = z.object({ port: z.number() }).parse(socket.address());
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const start = () =>
    spawn(process.execPath, [join(dir, "runner.mjs")], {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        SPARKLES_AGENT: "codex",
        SPARKLES_WORKSPACE_DIR: dir,
        SPARKLES_STATE_DIR: join(dir, "state"),
        SPARKLES_AGENT_PORT: String(port),
      },
      stdio: "ignore",
    });
  let runner = start();
  cleanup.push(async () => {
    const exited = once(runner, "exit");
    runner.kill();
    await exited;
    await rm(dir, { recursive: true, force: true });
  });
  const command = async (body: RunnerCommand) => {
    const response = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Command failed: ${response.status}`);
    return agentSnapshotSchema.parse(await response.json());
  };
  const waitReady = () =>
    expect
      .poll(
        async () => {
          try {
            return (await command({ kind: "events", cursor: 0 })).status;
          } catch {
            return "starting";
          }
        },
        { timeout: 5000 },
      )
      .toBe("idle");
  await waitReady();
  expect((await command({ kind: "events", cursor: 0 })).permissionModes?.currentModeId).toBe(
    "read-only",
  );
  await expect(command({ kind: "set_permission_mode", modeId: "agent" })).rejects.toThrow("409");
  expect((await command({ kind: "events", cursor: 0 })).permissionModes?.currentModeId).toBe(
    "read-only",
  );
  const changed = await command({ kind: "set_permission_mode", modeId: "agent" });
  expect(changed.permissionModes?.currentModeId).toBe("agent");
  expect(changed.events.at(-1)?.type).toBe("permission_modes");
  await command({ kind: "prompt", requestId: crypto.randomUUID(), prompt: "Inspect the repo" });
  await expect
    .poll(async () =>
      (await command({ kind: "events", cursor: 0 })).events.some(
        (event) => event.type === "permission",
      ),
    )
    .toBe(true);
  const pending = await command({ kind: "events", cursor: 0 });
  expect(JSON.stringify(pending)).toContain("mode=agent");
  const switched = await command({ kind: "set_permission_mode", modeId: "agent-full-access" });
  expect(switched.status).toBe("running");
  expect(switched.permissionModes?.currentModeId).toBe("agent-full-access");
  expect(switched.events.some((event) => event.type === "permission_resolved")).toBe(false);
  const approval = pending.events.find((event) => event.type === "permission")!;
  await command({ kind: "permission", id: z.string().parse(approval.data.id), optionId: "reject" });
  await waitReady();
  const checkpointId = crypto.randomUUID();
  const prepared = await fetch(`http://127.0.0.1:${port}`, {
    method: "POST",
    body: JSON.stringify({ kind: "prepare_checkpoint", id: checkpointId }),
  });
  expect(prepared.ok).toBe(true);
  await expect(command({ kind: "set_permission_mode", modeId: "read-only" })).rejects.toThrow(
    "409",
  );
  await command({ kind: "release_checkpoint", id: checkpointId });
  const saved = JSON.parse(await readFile(join(dir, "state/runner-state.json"), "utf8"));
  expect(saved.permissionMode).toBe("agent-full-access");
  const exited = once(runner, "exit");
  runner.kill();
  await exited;
  runner = start();
  await waitReady();
  const restored = await command({ kind: "events", cursor: 0 });
  expect(restored.permissionModes?.currentModeId).toBe("agent-full-access");
  expect(restored.events.some((event) => event.type === "restored")).toBe(true);
  await command({ kind: "set_permission_mode", modeId: "read-only" });
  expect((await command({ kind: "events", cursor: 0 })).permissionModes?.currentModeId).toBe(
    "read-only",
  );
});
