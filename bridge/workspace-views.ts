import type { Sandbox } from "modal";
import { z } from "zod";
import { workspaceFilesSource } from "./workspace-files-source.ts";
import { workspaceServicesSource } from "./workspace-services-source.ts";
import { workspaceViewResultSchema } from "./workspace-view-contracts.ts";
import type { WorkspaceViewResult } from "./workspace-view-contracts.ts";
import type { BridgeRequest } from "./contracts.ts";

export async function serviceRequest(sandbox: Sandbox, input: string) {
  const process = await sandbox.exec(
    [
      "node",
      "-e",
      `
    let body = ''; process.stdin.on('data', chunk => body += chunk);
    process.stdin.on('end', async () => {
      try {
        const response = await fetch('http://127.0.0.1:4098', {method:'POST',body,signal:AbortSignal.timeout(10000)});
        process.stdout.write(await response.text());
      } catch { process.exitCode = 1; }
    });
  `,
    ],
    { timeoutMs: 15000 },
  );
  await process.stdin.writeText(input);
  await process.stdin.close();
  const [output, code] = await Promise.all([process.stdout.readText(), process.wait()]);
  if (code !== 0) throw new Error("Workspace views are unavailable.");
  return output;
}

export async function ensureWorkspaceServices(sandbox: Sandbox) {
  await sandbox.filesystem.writeText(
    workspaceServicesSource,
    "/opt/sparkles/workspace-services.mjs",
  );
  const process = await sandbox.exec([
    "sh",
    "-c",
    "flock -n /tmp/sparkles-views.lock node /opt/sparkles/workspace-services.mjs > /tmp/sparkles-views.log 2>&1 < /dev/null &",
  ]);
  await process.wait();
  const ready = await sandbox.exec(
    [
      "node",
      "-e",
      `
    for (let attempt = 0; attempt < 30; attempt++) {
      try { const response = await fetch('http://127.0.0.1:4098', {method:'POST',body:'{"kind":"services"}'}); if(response.ok) process.exit(0); } catch {}
      await new Promise(resolve => setTimeout(resolve,100));
    }
    process.exit(1);
  `,
    ],
    { timeoutMs: 10000 },
  );
  if ((await ready.wait()) !== 0) throw new Error("Workspace views could not start.");
}

export async function workspaceView(
  sandbox: Sandbox,
  request: Extract<BridgeRequest, { action: "view" }>,
): Promise<WorkspaceViewResult> {
  if (request.command.kind === "files" || request.command.kind === "file") {
    const process = await sandbox.exec(["node", "-e", workspaceFilesSource], { timeoutMs: 45000 });
    await process.stdin.writeText(JSON.stringify(request));
    await process.stdin.close();
    const [output, code] = await Promise.all([process.stdout.readText(), process.wait()]);
    if (code !== 0)
      return {
        kind: "error",
        message:
          "This file could not be read. It may have moved, exceed the size limit, or be outside the repository.",
      };
    return workspaceViewResultSchema.parse(JSON.parse(output));
  }
  const input = JSON.stringify({
    ...request.command,
    expiresAt: request.expiresAt,
    parentOrigin: request.parentOrigin,
  });
  let body: string;
  try {
    body = await serviceRequest(sandbox, input);
  } catch {
    await ensureWorkspaceServices(sandbox);
    body = await serviceRequest(sandbox, input);
  }
  const output = JSON.parse(body);
  const failure = z.object({ error: z.string() }).safeParse(output);
  if (failure.success) return { kind: "error", message: failure.data.error };
  if (request.command.kind !== "connect") return workspaceViewResultSchema.parse(output);
  const connection = z.object({ token: z.string(), expiresAt: z.number() }).parse(output);
  const tunnels = await sandbox.tunnels();
  const port = request.command.service === "preview" ? 8080 : 6080;
  const tunnel = tunnels[port];
  if (!tunnel)
    return {
      kind: "error",
      message: "Stop and resume this workspace to enable its new Preview and Desktop connections.",
    };
  const url = new URL("/__sparkles_connect", tunnel.url);
  url.hash = connection.token;
  return {
    kind: "connect",
    service: request.command.service,
    url: url.href,
    expiresAt: connection.expiresAt,
  };
}

export async function revokeWorkspaceViews(sandbox: Sandbox) {
  try {
    await serviceRequest(sandbox, JSON.stringify({ kind: "revoke" }));
  } catch {
    /* Views may never have been started. */
  }
}
