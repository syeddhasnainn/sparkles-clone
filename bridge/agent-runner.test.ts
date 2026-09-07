import { z } from "zod";
import type { AgentCommand } from "./contracts";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { agentRunnerSource } from "./agent-runner-source";
import { agentSnapshotSchema } from "./contracts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});

describe("sandbox ACP runner", () => {
  it("streams updates, forwards permission decisions, and deduplicates prompt retries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sparkles-acp-"));
    await symlink(new URL("./node_modules", import.meta.url).pathname, join(dir, "node_modules"));
    await writeFile(join(dir, "runner.mjs"), agentRunnerSource);
    await writeFile(
      join(dir, "opencode"),
      `#!/usr/bin/env node
const readline = require('node:readline');
const send = message => process.stdout.write(JSON.stringify({jsonrpc:'2.0', ...message})+'\\n');
let promptId;
readline.createInterface({input:process.stdin}).on('line', line => {
 const message=JSON.parse(line);
 if(['session/new','session/load'].includes(message.method)) require('node:fs').writeFileSync(message.method.split('/')[1]+'-mcp.json', JSON.stringify(message.params.mcpServers));
 if(message.method==='initialize') send({id:message.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true},authMethods:[]}});
 if(message.method==='session/load') {
  send({method:'session/update',params:{sessionId:'test-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'REPLAY_SHOULD_BE_IGNORED'}}}});
  send({id:message.id,result:{}});
 }
 if(message.method==='session/new') send({id:message.id,result:{sessionId:'test-session'}});
 if(message.method==='session/prompt') {
  require('node:fs').writeFileSync('received-prompt.json', JSON.stringify(message.params.prompt));
  promptId=message.id;
  send({method:'session/update',params:{sessionId:'test-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Working'}}}});
  send({id:'permission-1',method:'session/request_permission',params:{sessionId:'test-session',toolCall:{toolCallId:'tool-1',title:'Write test file',kind:'edit'},options:[{optionId:'allow',name:'Allow once',kind:'allow_once'},{optionId:'deny',name:'Reject',kind:'reject_once'}]}});
 }
 if(message.id==='permission-1' && message.result) send({id:promptId,result:{stopReason:message.result.outcome.optionId==='allow'?'end_turn':'cancelled'}});
});
`,
      { mode: 0o700 },
    );
    const socket = createServer();
    await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
    const address = z.object({ port: z.number() }).parse(socket.address());
    const port = address.port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    let previewReady = false;
    const supervisor = createHttpServer((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          kind: "services",
          preview: {
            status: previewReady ? "ready" : "stopped",
            port: 3000,
            command: "pnpm run dev",
            title: "Sparkles dev server",
          },
        }),
      );
    });
    await new Promise<void>((resolve) => supervisor.listen(0, "127.0.0.1", resolve));
    const controlPort = z.object({ port: z.number() }).parse(supervisor.address()).port;
    const startRunner = () =>
      spawn(process.execPath, [join(dir, "runner.mjs")], {
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          SPARKLES_WORKSPACE_DIR: dir,
          SPARKLES_STATE_DIR: join(dir, "state"),
          SPARKLES_AGENT_PORT: String(port),
          SPARKLES_VIEWS_CONTROL_PORT: String(controlPort),
        },
        stdio: "ignore",
      });
    let runner = startRunner();
    cleanup.push(async () => {
      runner.kill();
      supervisor.closeAllConnections();
      await new Promise<void>((resolve) => supervisor.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    });
    const command = async (body: AgentCommand) => {
      const response = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      expect(response.ok).toBe(true);
      return agentSnapshotSchema.parse(await response.json());
    };
    await expect
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
    const expectedComputerServer = [
      {
        name: "computer",
        command: "/usr/bin/python3",
        args: ["/opt/sparkles/computer-mcp.py"],
        env: [
          { name: "SPARKLES_STATE_DIR", value: join(dir, "state") },
          { name: "SPARKLES_WORKSPACE_DIR", value: dir },
        ],
      },
    ];
    expect(JSON.parse(await readFile(join(dir, "new-mcp.json"), "utf8"))).toEqual(
      expectedComputerServer,
    );
    const prompt: AgentCommand = {
      kind: "prompt",
      requestId: crypto.randomUUID(),
      prompt: "Create a test file",
    };
    await command(prompt);
    await command(prompt);
    await expect
      .poll(async () =>
        (await command({ kind: "events", cursor: 0 })).events.some(
          (event) => event.type === "permission",
        ),
      )
      .toBe(true);
    const state = await command({ kind: "events", cursor: 0 });
    const suppliedPrompt = JSON.parse(await readFile(join(dir, "received-prompt.json"), "utf8"));
    expect(suppliedPrompt[0].text).toContain("preview-start");
    expect(suppliedPrompt[1].text).toBe("Create a test file");
    expect(JSON.stringify(state.events)).not.toContain("Sparkles workspace capabilities");
    expect(state.events.some((event) => event.type === "preview")).toBe(false);
    expect(state.events.filter((event) => event.type === "user")).toHaveLength(1);
    expect(
      state.events.some(
        (event) => event.type === "update" && event.data.sessionUpdate === "agent_message_chunk",
      ),
    ).toBe(true);
    const permission = state.events.find((event) => event.type === "permission");
    previewReady = true;
    await command({
      kind: "permission",
      id: z.string().parse(permission?.data.id),
      optionId: "allow",
    });
    await expect
      .poll(async () => (await command({ kind: "events", cursor: 0 })).status)
      .toBe("idle");
    const previewEvents = (await command({ kind: "events", cursor: 0 })).events.filter(
      (event) => event.type === "preview",
    );
    expect(previewEvents).toHaveLength(1);
    expect(previewEvents[0].data).toEqual({ title: "Sparkles dev server", port: 3000 });
    expect(
      (await command({ kind: "events", cursor: state.cursor })).events.some(
        (event) => event.type === "complete",
      ),
    ).toBe(true);
    await command({ kind: "prompt", requestId: crypto.randomUUID(), prompt: "Another test" });
    await expect
      .poll(
        async () =>
          (await command({ kind: "events", cursor: state.cursor })).events.filter(
            (event) => event.type === "permission",
          ).length,
      )
      .toBe(1);
    await command({ kind: "cancel" });
    await expect
      .poll(async () => (await command({ kind: "events", cursor: 0 })).status)
      .toBe("idle");
    const saved = await command({ kind: "events", cursor: 0 });
    const exited = new Promise<void>((resolve) => runner.once("exit", () => resolve()));
    runner.kill();
    await exited;
    runner = startRunner();
    await expect
      .poll(
        async () => {
          try {
            return (await command({ kind: "events", cursor: saved.cursor })).status;
          } catch {
            return "starting";
          }
        },
        { timeout: 5000 },
      )
      .toBe("idle");
    await command(prompt);
    const restored = await command({ kind: "events", cursor: saved.cursor });
    const restoredPreviews = (await command({ kind: "events", cursor: 0 })).events.filter(
      (event) => event.type === "preview",
    );
    expect(restoredPreviews).toEqual(previewEvents);
    expect(JSON.parse(await readFile(join(dir, "load-mcp.json"), "utf8"))).toEqual(
      expectedComputerServer,
    );
    expect(restored.sessionId).toBe(saved.sessionId);
    expect(restored.cursor).toBeGreaterThan(saved.cursor);
    expect(restored.events.some((event) => event.type === "restored")).toBe(true);
    expect(restored.events.some((event) => event.type === "user")).toBe(false);
    expect(JSON.stringify(restored)).not.toContain("REPLAY_SHOULD_BE_IGNORED");
  });
});
