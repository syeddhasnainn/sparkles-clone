import {
  githubCredentialHelper,
  githubCliWrapper,
  type GitHubCredentials,
} from "./github-credentials.ts";
import { createAgentEnvironment } from "./agent-environment.ts";
import { AlreadyExistsError, ModalClient, NotFoundError } from "modal";
import { z } from "zod";
import { computerMcpSource } from "./computer-mcp-source.ts";
import { agentRunnerSource } from "./agent-runner-source.ts";
import { runnerRequest } from "./agent-transport.ts";
import {
  workspaceView,
  revokeWorkspaceViews,
  ensureWorkspaceServices,
  serviceRequest,
} from "./workspace-views.ts";
import {
  captureBrowserProfileScript,
  resetLegacyBrowserProfileScript,
  restoreBrowserProfileScript,
} from "./browser-profile-scripts.ts";
import { createCheckpointScript, restoreCheckpointScript } from "./checkpoint-scripts.ts";
import { transferCheckpoint } from "./checkpoint-transfer.ts";
import { codexPolicyBuildCommand } from "./codex-policy.ts";
import {
  checkpointMetadataSchema,
  agentSnapshotSchema,
  browserProfileArchiveMetadataSchema,
} from "./contracts.ts";
import type {
  BrowserProfileArchive,
  BrowserProfileCaptureRequest,
  BrowserProfileResetRequest,
  BrowserProfileRestoreRequest,
  CheckpointArchive,
  CheckpointRequest,
  RestoreRequest,
} from "./contracts.ts";
import { checkoutScript } from "./checkout.ts";
import { checkpointGraceMs, workspaceLifetimeMs } from "./contracts.ts";
import type { BridgeRequest, BridgeResponse } from "./contracts.ts";

export interface SandboxProvider {
  execute(request: BridgeRequest): Promise<BridgeResponse>;
  checkpoint?(request: CheckpointRequest): Promise<CheckpointArchive>;
  restore?(request: RestoreRequest, body: ReadableStream<Uint8Array>): Promise<void>;
  captureBrowser?(request: BrowserProfileCaptureRequest): Promise<BrowserProfileArchive | null>;
  restoreBrowser?(
    request: BrowserProfileRestoreRequest,
    body: ReadableStream<Uint8Array>,
  ): Promise<void>;
  resetBrowser?(request: BrowserProfileResetRequest): Promise<void>;
}

export class ModalProvider implements SandboxProvider {
  private readonly client: ModalClient;

  private readonly appName: string;

  constructor(appName: string, credentials?: { tokenId: string; tokenSecret: string }) {
    this.client = new ModalClient(credentials);
    this.appName = appName;
  }

  close() {
    this.client.close();
  }

  async execute(request: BridgeRequest): Promise<BridgeResponse> {
    let sandbox;

    try {
      sandbox = await this.client.sandboxes.fromName(this.appName, request.name);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      if (request.action !== "create" && request.action !== "allocate")
        return { running: false, sandboxId: null, commit: null };

      const app = await this.client.apps.fromName(this.appName, { createIfMissing: true });
      const image = this.client.images
        .fromRegistry("node:22-bookworm")
        .dockerfileCommands([
          "RUN apt-get update && apt-get install -y --no-install-recommends python3 gh ripgrep chromium xvfb x11vnc novnc websockify xfce4-session xfwm4 xfce4-panel xfdesktop4 thunar xfce4-terminal dbus-x11 xdotool imagemagick x11-utils x11-xserver-utils xterm fonts-liberation && rg --version && rm -rf /var/lib/apt/lists/*",
          "RUN npm install --global pnpm@12.0.0",
          "RUN npm install --global opencode-ai@1.18.29 @agentclientprotocol/codex-acp@1.10.0 @openai/codex@0.153.3",
          codexPolicyBuildCommand,
          "RUN npm install --prefix /opt/sparkles @agentclientprotocol/sdk@1.4.0",
        ]);

      try {
        sandbox = await this.client.sandboxes.create(app, image, {
          name: request.name,
          secrets:
            request.projectEnvironment && Object.keys(request.projectEnvironment).length
              ? [
                  await this.client.secrets.fromObject({
                    ...request.projectEnvironment,
                    SPARKLES_PROJECT_ENV_NAMES: JSON.stringify(
                      Object.keys(request.projectEnvironment),
                    ),
                  }),
                ]
              : [],
          cpu: 2,
          cpuLimit: 2,
          memoryMiB: 4096,
          memoryLimitMiB: 4096,
          timeoutMs: workspaceLifetimeMs + checkpointGraceMs,
          tags: { application: "sparkles" },
          encryptedPorts: [8080, 6080],
        });
      } catch (createError) {
        if (!(createError instanceof AlreadyExistsError)) throw createError;
        sandbox = await this.client.sandboxes.fromName(this.appName, request.name);
      }
    }

    try {
      if (request.action === "view") {
        return {
          running: true,
          sandboxId: sandbox.sandboxId,
          commit: null,
          view: await workspaceView(sandbox, request),
        };
      }
      if (request.action === "stop") {
        await revokeWorkspaceViews(sandbox);
        await sandbox.terminate({ wait: true });
        return { running: false, sandboxId: sandbox.sandboxId, commit: null };
      }

      if (request.action === "agent" || request.action === "sync") {
        const command =
          request.action === "agent"
            ? request.command
            : { kind: "sync" as const, cursor: request.cursor, acknowledge: request.acknowledge };
        return {
          running: true,
          sandboxId: sandbox.sandboxId,
          commit: null,
          agent: agentSnapshotSchema.parse(await runnerRequest(sandbox, command)),
        };
      }
      if (request.action === "start") {
        await this.startRunner(sandbox, request.gateway, request.github);
        return { running: true, sandboxId: sandbox.sandboxId, commit: null };
      }
      if (request.action !== "create") {
        return {
          running: (await sandbox.poll()) === null,
          sandboxId: sandbox.sandboxId,
          commit: null,
        };
      }

      const process = await sandbox.exec(
        ["flock", "-w", "130", "/tmp/sparkles-checkout.lock", "node", "-e", checkoutScript],
        { timeoutMs: 150_000 },
      );
      await process.stdin.writeText(
        JSON.stringify({
          token: request.token,
          repository: request.repository.name,
          branch: request.repository.defaultBranch,
          branchName: `sparkles/${request.name.slice(9)}`,
        }),
      );
      await process.stdin.close();
      const [output, exitCode] = await Promise.all([process.stdout.readText(), process.wait()]);

      if (exitCode !== 0) throw new Error("Repository checkout failed.");

      const { commit } = z
        .object({ commit: z.string().regex(/^[a-f0-9]{40,64}$/) })
        .parse(JSON.parse(output));
      await this.startRunner(sandbox, request.gateway, request.github);
      return { running: true, sandboxId: sandbox.sandboxId, commit };
    } finally {
      sandbox.detach();
    }
  }
  private async startRunner(
    sandbox: import("modal").Sandbox,
    gateway?: { url: string; token: string; model: string },
    github?: GitHubCredentials,
  ) {
    if (!gateway) throw new Error("Model gateway is not configured.");
    if (github) {
      const configure = await sandbox.exec([
        "node",
        "-e",
        `
        const fs = require('node:fs');
        const { execFileSync } = require('node:child_process');
        const config = JSON.parse(fs.readFileSync(0, 'utf8'));
        fs.mkdirSync('/opt/sparkles', { recursive: true });
        fs.writeFileSync('/opt/sparkles/github-credentials.json', JSON.stringify(config.github), { mode: 0o600 });
        fs.chmodSync('/opt/sparkles/github-credentials.json', 0o600);
        fs.writeFileSync('/opt/sparkles/git-credential-sparkles', config.helper, { mode: 0o755 });
        fs.writeFileSync('/usr/local/bin/gh', config.wrapper, { mode: 0o755 });
        for (const [key, value] of Object.entries({
          'user.name': config.github.name,
          'user.email': config.github.email,
          'credential.https://github.com.useHttpPath': 'true',
          'credential.https://github.com.helper': '/opt/sparkles/git-credential-sparkles',
        })) execFileSync('git', ['config', '--global', '--replace-all', key, value]);
      `,
      ]);
      await configure.stdin.writeText(
        JSON.stringify({ github, helper: githubCredentialHelper, wrapper: githubCliWrapper }),
      );
      await configure.stdin.close();
      if ((await configure.wait()) !== 0) throw new Error("Workspace GitHub configuration failed.");
    }
    await ensureWorkspaceServices(sandbox);
    await sandbox.filesystem.writeText(computerMcpSource, "/opt/sparkles/computer-mcp.py");
    await sandbox.filesystem.writeText(agentRunnerSource, "/opt/sparkles/agent-runner.mjs");
    const runner = await sandbox.exec(
      [
        "sh",
        "-c",
        "flock -n /tmp/sparkles-agent.lock node /opt/sparkles/agent-runner.mjs > /tmp/sparkles-agent.log 2>&1 < /dev/null &",
      ],
      { env: createAgentEnvironment(gateway) },
    );
    await runner.wait();
  }

  async checkpoint(request: CheckpointRequest): Promise<CheckpointArchive> {
    const sandbox = await this.client.sandboxes.fromName(this.appName, request.name);
    let transferred = false;
    try {
      const prepared = await runnerRequest(sandbox, { kind: "prepare_checkpoint", id: request.id });
      let metadata;
      try {
        const process = await sandbox.exec(["python3", "-c", createCheckpointScript], {
          timeoutMs: 150000,
        });
        await process.stdin.writeText(JSON.stringify(prepared));
        await process.stdin.close();
        const [output, code] = await Promise.all([process.stdout.readText(), process.wait()]);
        if (code !== 0) throw new Error("Workspace checkpoint failed.");
        metadata = checkpointMetadataSchema.parse(JSON.parse(output));
      } finally {
        await runnerRequest(sandbox, { kind: "release_checkpoint", id: request.id });
      }
      const archivePath = `/tmp/sparkles-checkpoint-${request.id}.tar.gz`;
      const download = await sandbox.exec(["cat", archivePath], {
        mode: "binary",
        timeoutMs: 180000,
      });
      const reader = download.stdout.getReader();
      const finish = async () => {
        const cleanup = await sandbox.exec(["rm", "-f", archivePath]);
        await cleanup.wait();
        sandbox.detach();
      };
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              if ((await download.wait()) !== 0) throw new Error("Checkpoint transfer failed.");
              await finish();
              controller.close();
            } else controller.enqueue(next.value);
          } catch (error) {
            sandbox.detach();
            controller.error(error);
          }
        },
        async cancel() {
          await reader.cancel();
          await finish();
        },
      });
      transferred = true;
      return { metadata, body };
    } finally {
      if (!transferred) sandbox.detach();
    }
  }

  async restore(request: RestoreRequest, body: ReadableStream<Uint8Array>): Promise<void> {
    const sandbox = await this.client.sandboxes.fromName(this.appName, request.name);
    try {
      const process = await sandbox.exec(
        ["python3", "-c", restoreCheckpointScript, JSON.stringify(request)],
        { mode: "binary", timeoutMs: 240000 },
      );
      const received = await transferCheckpoint(body, process.stdin, request.checkpoint.size);
      // Decode the byte view itself; the SDK binary readText helper includes its backing buffer.
      const [output, code] = await Promise.all([
        new Response(process.stdout).text(),
        process.wait(),
      ]);
      if (code !== 0 || received !== request.checkpoint.size)
        throw new Error("Workspace restoration failed.");
      z.object({ restored: z.literal(true) }).parse(JSON.parse(output));
    } finally {
      sandbox.detach();
    }
  }

  async captureBrowser(
    request: BrowserProfileCaptureRequest,
  ): Promise<BrowserProfileArchive | null> {
    const sandbox = await this.client.sandboxes.fromName(this.appName, request.name);
    let quiesced = false;
    let transferred = false;

    try {
      await ensureWorkspaceServices(sandbox);
      const browser = z
        .object({
          operation: z.literal("browser-quiesced"),
          version: z.literal(1),
          started: z.boolean(),
        })
        .parse(
          JSON.parse(await serviceRequest(sandbox, JSON.stringify({ kind: "browser-quiesce" }))),
        );
      quiesced = true;
      if (!browser.started) {
        await this.releaseBrowser(sandbox, "browser-release", "browser-released");
        quiesced = false;
        return null;
      }

      const process = await sandbox.exec(["python3", "-c", captureBrowserProfileScript], {
        timeoutMs: 150_000,
      });
      await process.stdin.writeText(JSON.stringify({ id: request.id }));
      await process.stdin.close();
      const [output, code] = await Promise.all([process.stdout.readText(), process.wait()]);
      if (code !== 0) throw new Error("Browser profile capture failed.");
      const result = z
        .discriminatedUnion("present", [
          z.object({ present: z.literal(false) }),
          z.object({
            present: z.literal(true),
            metadata: browserProfileArchiveMetadataSchema,
          }),
        ])
        .parse(JSON.parse(output));

      await this.releaseBrowser(sandbox, "browser-release", "browser-released");
      quiesced = false;
      if (!result.present) return null;

      const archivePath = `/tmp/sparkles-browser-profile-${request.id}.tar.gz`;
      const download = await sandbox.exec(["cat", archivePath], {
        mode: "binary",
        timeoutMs: 180_000,
      });
      const reader = download.stdout.getReader();
      const finish = async () => {
        const cleanup = await sandbox.exec(["rm", "-f", archivePath]);
        await cleanup.wait();
        sandbox.detach();
      };
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              if ((await download.wait()) !== 0)
                throw new Error("Browser profile transfer failed.");
              await finish();
              controller.close();
            } else controller.enqueue(next.value);
          } catch (error) {
            sandbox.detach();
            controller.error(error);
          }
        },
        async cancel() {
          await reader.cancel();
          await finish();
        },
      });
      transferred = true;
      return { metadata: result.metadata, body };
    } finally {
      if (quiesced)
        await this.releaseBrowser(sandbox, "browser-release", "browser-released").catch(() => {});
      if (!transferred) sandbox.detach();
    }
  }

  async restoreBrowser(
    request: BrowserProfileRestoreRequest,
    body: ReadableStream<Uint8Array>,
  ): Promise<void> {
    const sandbox = await this.client.sandboxes.fromName(this.appName, request.name);
    let quiesced = false;

    try {
      await ensureWorkspaceServices(sandbox);
      z.object({
        operation: z.literal("browser-quiesced"),
        version: z.literal(1),
        started: z.boolean(),
      }).parse(
        JSON.parse(await serviceRequest(sandbox, JSON.stringify({ kind: "browser-quiesce" }))),
      );
      quiesced = true;

      const process = await sandbox.exec(
        ["python3", "-c", restoreBrowserProfileScript, JSON.stringify(request)],
        { mode: "binary", timeoutMs: 240_000 },
      );
      const received = await transferCheckpoint(body, process.stdin, request.profile.size);
      const [output, code] = await Promise.all([
        new Response(process.stdout).text(),
        process.wait(),
      ]);
      if (code !== 0 || received !== request.profile.size)
        throw new Error("Browser profile restoration failed.");
      z.object({ restored: z.literal(true) }).parse(JSON.parse(output));

      await this.releaseBrowser(sandbox, "browser-replace-release", "browser-replaced");
      quiesced = false;
    } finally {
      if (quiesced)
        await this.releaseBrowser(sandbox, "browser-release", "browser-released").catch(() => {});
      sandbox.detach();
    }
  }

  async resetBrowser(request: BrowserProfileResetRequest): Promise<void> {
    let sandbox;
    try {
      sandbox = await this.client.sandboxes.fromName(this.appName, request.name);
    } catch (error) {
      if (error instanceof NotFoundError) return;
      throw error;
    }
    try {
      let response;
      try {
        response = JSON.parse(
          await serviceRequest(sandbox, JSON.stringify({ kind: "browser-reset" })),
        );
      } catch {
        response = null;
      }
      const reset = z
        .object({ operation: z.literal("browser-reset"), version: z.literal(1) })
        .safeParse(response);
      if (reset.success) return;
      if (z.object({ error: z.string() }).safeParse(response).success)
        throw new Error("Cloud-browser session reset failed.");

      const legacy = await sandbox.exec(["python3", "-c", resetLegacyBrowserProfileScript], {
        timeoutMs: 30_000,
      });
      const [output, code] = await Promise.all([legacy.stdout.readText(), legacy.wait()]);
      if (code !== 0) throw new Error("Cloud-browser session reset failed.");
      z.object({ operation: z.literal("browser-reset"), version: z.literal(1) }).parse(
        JSON.parse(output),
      );
    } finally {
      sandbox.detach();
    }
  }

  private async releaseBrowser(
    sandbox: import("modal").Sandbox,
    kind: "browser-release" | "browser-replace-release",
    operation: "browser-released" | "browser-replaced",
  ) {
    z.object({ operation: z.literal(operation), version: z.literal(1) }).parse(
      JSON.parse(await serviceRequest(sandbox, JSON.stringify({ kind }))),
    );
  }
}
