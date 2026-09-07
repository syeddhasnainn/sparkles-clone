import { revokeModelGateway } from "./model-gateway";
import { DurableObject } from "cloudflare:workers";
import { createSessionStore } from "./session-store";
import { createCheckpointStore } from "./checkpoint-store";
import { createBrowserProfileStore } from "./browser-profile-store";
import { WorkspaceController } from "./controller";
import type { WorkspaceStorage } from "./controller";
import type { WorkspaceRecord } from "./controller";
import { WorkspaceActivityStore } from "./activity";
import { readTaskPullRequest } from "./pull-request";
import { githubRequest } from "../github/service.server";
import { authorizeRepository, createCheckoutToken, revokeCheckoutToken } from "./github.server";
import { containerProvider } from "./provider.server";
import type { AgentCommand, CreateWorkspace } from "../../../bridge/contracts";
import type { WorkspaceViewCommand } from "../../../bridge/workspace-view-contracts";

function workspaceStorage(
  storage: DurableObjectStorage,
  current: Pick<
    DurableObjectStorage,
    "get" | "put" | "list" | "getAlarm" | "setAlarm" | "deleteAlarm"
  > = storage,
): WorkspaceStorage {
  return {
    get: (key) => current.get(key),
    put: (key, record) => current.put(key, record),
    list: () => current.list({ prefix: "workspace:" }),
    getAlarm: () => current.getAlarm(),
    setAlarm: (time) => current.setAlarm(time),
    deleteAlarm: () => current.deleteAlarm(),
    transaction: (callback) =>
      storage.transaction((transaction) => callback(workspaceStorage(storage, transaction))),
  };
}

export class WorkspaceManager extends DurableObject<Env> {
  private controller = new WorkspaceController(workspaceStorage(this.ctx.storage), {
    sessions: createSessionStore(this.env.DB),
    checkpoints: createCheckpointStore(this.env.CHECKPOINTS),
    browserProfiles: createBrowserProfileStore(
      this.env.DB,
      this.env.CHECKPOINTS,
      this.env.GITHUB_TOKEN_ENCRYPTION_KEY,
    ),
    authorize: authorizeRepository,
    checkoutToken: createCheckoutToken,
    revokeCheckoutToken,
    provider: (id) => containerProvider(this.env, `bridge-${parseInt(id[0], 16) % 4}`, id),
  });

  private activity = new WorkspaceActivityStore(this.ctx.storage, {
    pullRequest: (record, known) =>
      readTaskPullRequest(githubRequest, record.userId, record, known),
    changes: async (record) => {
      const result = await this.controller.view(
        record.id,
        { kind: "files", scope: "changed", base: "task" },
        this.env.MODEL_GATEWAY_URL,
        false,
      );
      if (result.kind !== "files") throw new Error("Workspace changes are unavailable.");
      return {
        additions: result.files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
        deletions: result.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
        partial:
          result.truncated ||
          result.files.some((file) => file.additions === null || file.deletions === null),
      };
    },
  });

  private async refreshActivity() {
    const records = await this.ctx.storage.list<WorkspaceRecord>({ prefix: "workspace:" });
    await this.activity.refresh([...records.values()]);
  }

  async list() {
    const workspaces = await this.controller.list();
    this.ctx.waitUntil(this.refreshActivity());
    return this.activity.enrich(workspaces);
  }
  browserSessions(userId: string) {
    return this.controller.browserSessions(userId);
  }
  clearBrowserSessions(userId: string) {
    return this.controller.clearBrowserSessions(userId);
  }
  start(userId: string, input: CreateWorkspace) {
    return this.controller.start(userId, input);
  }
  agent(id: string, command: AgentCommand) {
    return this.controller.agent(id, command);
  }
  conversation(id: string) {
    return this.controller.conversation(id);
  }
  view(id: string, command: WorkspaceViewCommand, parentOrigin: string) {
    return this.controller.view(id, command, parentOrigin);
  }
  resume(id: string) {
    return this.controller.resume(id);
  }
  async stop(id: string) {
    const runId = await this.controller.stop(id);
    await revokeModelGateway(this.env.DB, runId);
  }
  async alarm() {
    await this.controller.alarm();
    this.ctx.waitUntil(this.refreshActivity());
  }
}
