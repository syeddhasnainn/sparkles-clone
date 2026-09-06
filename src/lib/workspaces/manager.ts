import { revokeModelGateway } from "./model-gateway";
import { DurableObject } from "cloudflare:workers";
import { createSessionStore } from "./session-store";
import { createCheckpointStore } from "./checkpoint-store";
import { WorkspaceController } from "./controller";
import type { WorkspaceStorage } from "./controller";
import { authorizeRepository, createCheckoutToken, revokeCheckoutToken } from "./github.server";
import { containerProvider } from "./provider.server";
import type { AgentCommand, CreateWorkspace } from "../../../bridge/contracts";
import type { WorkspaceViewCommand } from "../../../bridge/workspace-view-contracts";

function workspaceStorage(
  storage: DurableObjectStorage,
  current: Pick<
    DurableObjectStorage,
    "get" | "put" | "list" | "setAlarm" | "deleteAlarm"
  > = storage,
): WorkspaceStorage {
  return {
    get: (key) => current.get(key),
    put: (key, record) => current.put(key, record),
    list: () => current.list({ prefix: "workspace:" }),
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
    authorize: authorizeRepository,
    checkoutToken: createCheckoutToken,
    revokeCheckoutToken,
    provider: (id) => containerProvider(this.env, `bridge-${parseInt(id[0], 16) % 4}`, id),
  });

  list() {
    return this.controller.list();
  }
  start(userId: string, input: CreateWorkspace) {
    return this.controller.start(userId, input);
  }
  agent(id: string, command: AgentCommand) {
    return this.controller.agent(id, command);
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
  alarm() {
    return this.controller.alarm();
  }
}
