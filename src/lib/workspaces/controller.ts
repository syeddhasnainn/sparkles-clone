import {
  checkpointIntervalMs,
  workspaceIdleTimeoutMs,
  workspaceLifetimeMs,
} from "../../../bridge/contracts";
import { defaultAgentSelection } from "../../../bridge/agent-selection";
import type { WorkspaceViewCommand } from "../../../bridge/workspace-view-contracts";
import type {
  AgentCommand,
  AgentSnapshot,
  CreateWorkspace,
  Repository,
  Workspace,
} from "../../../bridge/contracts";
import type { WorkspaceProvider } from "./provider.server";
import type { SavedCheckpoint, SessionOwner, SessionStore } from "./session-store";
import type { CheckpointStore } from "./checkpoint-store";
import { BrowserProfileConflictError } from "./browser-profile-store";
import type {
  BrowserProfileLease,
  BrowserProfileOwner,
  BrowserProfileStore,
} from "./browser-profile-store";

export interface WorkspaceRecord extends Workspace {
  userId: string;
  requestId: string;
  attempts: number;
  retryAt: number;
  terminalStatus: "stopped" | "failed";
  agentStarted?: boolean;
  runId?: string;
  checkpointCursor?: number;
  restoreCheckpoint?: SavedCheckpoint;
  stopRequestedAt?: number;
  idleSince?: number;
  pendingPrompt?: Extract<AgentCommand, { kind: "prompt" }>;
  browserLease?: BrowserProfileLease;
  browserReady?: boolean;
  browserProfileAt?: number;
  browserSaveBlocked?: boolean;
}

function publicWorkspace(record: WorkspaceRecord): Workspace {
  const {
    userId: _userId,
    requestId: _requestId,
    attempts: _attempts,
    retryAt: _retryAt,
    terminalStatus: _terminalStatus,
    agentStarted: _agentStarted,
    runId: _runId,
    checkpointCursor: _checkpointCursor,
    restoreCheckpoint: _restoreCheckpoint,
    stopRequestedAt: _stopRequestedAt,
    idleSince: _idleSince,
    pendingPrompt: _pendingPrompt,
    browserLease: _browserLease,
    browserReady: _browserReady,
    browserProfileAt: _browserProfileAt,
    browserSaveBlocked: _browserSaveBlocked,
    ...workspace
  } = record;
  return workspace;
}
export interface WorkspaceStorage {
  get(key: string): Promise<WorkspaceRecord | undefined>;
  put(key: string, record: WorkspaceRecord): Promise<void>;
  list(): Promise<Map<string, WorkspaceRecord>>;
  getAlarm(): Promise<number | null>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
  transaction<T>(callback: (storage: WorkspaceStorage) => Promise<T>): Promise<T>;
}
export interface WorkspaceDependencies {
  authorize: (userId: string, repository: Repository) => Promise<Repository>;
  checkoutToken: (repository: Repository) => Promise<string>;
  revokeCheckoutToken?: (token: string) => Promise<void>;
  provider: (id: string) => WorkspaceProvider;
  sessions: SessionStore;
  checkpoints: CheckpointStore;
  browserProfiles: BrowserProfileStore;
}
const owner = (record: WorkspaceRecord): SessionOwner => ({
  taskId: record.id,
  userId: record.userId,
  runId: record.runId || record.id,
  selection: record.selection,
});
const sandboxName = (record: WorkspaceRecord) => `sparkles-${record.runId || record.id}`;
const browserOwner = (record: WorkspaceRecord): BrowserProfileOwner => ({
  userId: record.userId,
  repositoryId: record.repository.id,
});
const terminal = (record: WorkspaceRecord) => ["stopped", "failed"].includes(record.status);

export class WorkspaceController {
  private readonly syncs = new Map<string, Promise<AgentSnapshot | null>>();
  private readonly captures = new Map<string, Promise<void>>();
  private browserOperation: Promise<void> = Promise.resolve();
  constructor(
    private readonly storage: WorkspaceStorage,
    private readonly dependencies: WorkspaceDependencies,
  ) {}

  private runBrowserOperation<T>(callback: () => Promise<T>) {
    const operation = this.browserOperation.then(callback);
    this.browserOperation = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  async list(): Promise<Workspace[]> {
    return this.storage.transaction(async (storage) => {
      const records = [...(await storage.list()).values()];
      const now = Date.now();
      for (const record of records) {
        if (record.status === "ready" && record.expiresAt <= now) {
          record.status = "stopping";
          record.stopRequestedAt = now;
          record.retryAt = now;
          await storage.put(`workspace:${record.id}`, record);
        }
      }
      if (records.some((record) => !terminal(record) || record.pendingPrompt)) {
        if ((await storage.getAlarm()) === null) await storage.setAlarm(now + 100);
      }
      return records.sort((a, b) => b.createdAt - a.createdAt).map(publicWorkspace);
    });
  }
  async browserSessions(userId: string) {
    return this.runBrowserOperation(async () => {
      const cleanupPending = await this.dependencies.browserProfiles.cleanup(userId);
      const profiles = await this.dependencies.browserProfiles.list(userId);
      return {
        count: profiles.length,
        updatedAt: profiles[0]?.updatedAt ?? null,
        cleanupPending,
        projects: profiles.map((profile) => ({
          repositoryId: profile.repositoryId,
          repositoryName: profile.repositoryName,
          updatedAt: profile.updatedAt,
        })),
      };
    });
  }

  async clearBrowserSessions(userId: string) {
    return this.runBrowserOperation(async () => {
      const cleared = await this.dependencies.browserProfiles.clear(userId);
      const active = [...(await this.storage.list()).values()].filter(
        (record) => record.userId === userId && !terminal(record),
      );
      for (const record of active)
        await this.patch(record, {
          browserLease: { generation: cleared.generation, revision: 0 },
          browserProfileAt: Date.now(),
          browserSaveBlocked: true,
          browserSessionError: null,
        });

      const failures: string[] = [];
      for (const record of active) {
        const provider = this.dependencies.provider(record.id);
        try {
          if (!provider.resetBrowser)
            throw new Error("Cloud-browser session reset is unavailable.");
          await provider.resetBrowser({ name: sandboxName(record) });
          await this.patch(record, { browserSaveBlocked: false, browserSessionError: null });
        } catch {
          const message =
            "Saved sessions were cleared, but a running cloud browser could not be reset. Retry clearing before using it.";
          await this.patch(record, { browserSessionError: message });
          failures.push(record.id);
        }
      }
      if (failures.length)
        throw new Error(
          "Saved sessions were cleared, but a running cloud browser could not be reset. Retry clearing.",
        );
      return cleared;
    });
  }
  private async record(id: string) {
    const record = await this.storage.get(`workspace:${id}`);
    if (!record) throw new Error("Workspace not found.");
    return record;
  }
  private async patch(record: WorkspaceRecord, fields: Partial<WorkspaceRecord>) {
    await this.storage.transaction(async (storage) => {
      const current = await storage.get(`workspace:${record.id}`);
      if (current && owner(current).runId === owner(record).runId)
        await storage.put(`workspace:${record.id}`, { ...current, ...fields });
    });
  }
  async start(userId: string, input: CreateWorkspace): Promise<Workspace> {
    return this.storage.transaction(async (storage) => {
      const records = [...(await storage.list()).values()];
      const previous = records.find((record) => record.requestId === input.requestId);
      if (previous) {
        if (
          previous.prompt !== input.prompt ||
          previous.repository.id !== input.repository.id ||
          JSON.stringify(previous.selection ?? defaultAgentSelection) !==
            JSON.stringify(input.selection ?? defaultAgentSelection)
        )
          throw new Error("This request was already used for another workspace.");
        return publicWorkspace(previous);
      }
      if (records.filter((record) => !terminal(record)).length >= 3)
        throw new Error(
          "Stop an existing workspace before creating another. You can run three at once.",
        );
      const record: WorkspaceRecord = {
        id: crypto.randomUUID(),
        requestId: input.requestId,
        userId,
        prompt: input.prompt,
        selection: input.selection ?? defaultAgentSelection,
        repository: input.repository,
        status: "provisioning",
        phase: "sandbox",
        createdAt: Date.now(),
        expiresAt: Date.now() + workspaceLifetimeMs,
        sandboxId: null,
        commit: null,
        error: null,
        attempts: 0,
        retryAt: 0,
        terminalStatus: "stopped",
        checkpointAt: null,
        canResume: false,
      };
      await storage.put(`workspace:${record.id}`, record);
      await storage.setAlarm(Date.now() + 100);
      return publicWorkspace(record);
    });
  }
  async resume(id: string) {
    const saved = await this.record(id);
    if (!terminal(saved)) return;
    await this.dependencies.authorize(saved.userId, saved.repository);
    await this.dependencies.sessions.ensure(owner(saved));
    const checkpoint = await this.dependencies.sessions.latestCheckpoint(owner(saved));
    if (!checkpoint) throw new Error("This task has no saved workspace checkpoint to restore.");
    await this.storage.transaction(async (storage) => {
      const record = await storage.get(`workspace:${id}`);
      if (!record || !terminal(record)) return;
      const active = [...(await storage.list()).values()].filter((item) => !terminal(item));
      if (active.length >= 3)
        throw new Error(
          "Stop an existing workspace before resuming another. You can run three at once.",
        );
      await storage.put(`workspace:${id}`, {
        ...record,
        runId: crypto.randomUUID(),
        status: "provisioning",
        phase: "sandbox",
        restoring: true,
        restoreCheckpoint: checkpoint,
        agentStarted: true,
        expiresAt: Date.now() + workspaceLifetimeMs,
        error: null,
        attempts: 0,
        retryAt: 0,
        stopRequestedAt: undefined,
        idleSince: undefined,
        browserLease: undefined,
        browserReady: false,
        browserProfileAt: undefined,
        browserSaveBlocked: false,
        browserSessionError: null,
        sandboxId: null,
      });
      await storage.setAlarm(Date.now() + 100);
    });
  }
  async conversation(id: string): Promise<AgentSnapshot> {
    const record = await this.record(id);
    const sessionOwner = owner(record);
    await this.dependencies.sessions.ensure(sessionOwner);
    return this.dependencies.sessions.read(sessionOwner, 0, { all: true });
  }

  async agent(id: string, command: AgentCommand) {
    let record = await this.record(id);
    await this.dependencies.sessions.ensure(owner(record));
    if (command.kind === "events") {
      if (terminal(record))
        await this.dependencies.sessions.finish(owner(record), record.status === "failed");
      return this.dependencies.sessions.read(owner(record), command.cursor);
    }
    if (command.kind === "prompt" && record.status !== "ready") {
      if (terminal(record)) {
        await this.resume(id);
        record = await this.record(id);
      }
      await this.storage.transaction(async (storage) => {
        const current = await storage.get(`workspace:${id}`);
        if (!current) throw new Error("Workspace not found.");
        if (current.pendingPrompt && current.pendingPrompt.requestId !== command.requestId)
          throw new Error("A message is already waiting for this workspace.");
        await storage.put(`workspace:${id}`, {
          ...current,
          pendingPrompt: command,
          idleSince: undefined,
        });
        await storage.setAlarm(Date.now() + 100);
      });
      return this.dependencies.sessions.read(owner(record), 0);
    }
    await this.captures.get(owner(record).runId);
    record = await this.record(id);
    if (record.status !== "ready") throw new Error("Workspace is not ready.");
    if (command.kind === "prompt") {
      if (!record.agentStarted) throw new Error("The initial task is still starting.");
      await this.patch(record, { idleSince: undefined });
      await this.dependencies.sessions.reservePrompt(owner(record), command);
    }
    const current = await this.record(id);
    if (current.status !== "ready" || owner(current).runId !== owner(record).runId)
      throw new Error("Workspace stopped before the command could start.");
    const response = await this.dependencies
      .provider(id)
      .execute({ action: "agent", name: sandboxName(record), command });
    if (!response.agent) throw new Error("Agent is unavailable.");
    await this.patch(record, { retryAt: 0 });
    await this.storage.setAlarm(Date.now() + 100);
    return response.agent;
  }
  async view(id: string, command: WorkspaceViewCommand, parentOrigin: string) {
    const record = await this.record(id);
    if (record.status !== "ready" || record.expiresAt <= Date.now())
      throw new Error("Resume the workspace to open its files and live views.");
    await this.dependencies.authorize(record.userId, record.repository);
    const current = await this.record(id);
    if (current.status !== "ready" || owner(current).runId !== owner(record).runId)
      throw new Error("The workspace changed. Reconnect to its current session.");
    const response = await this.dependencies.provider(id).execute({
      action: "view",
      name: sandboxName(record),
      command,
      commit: record.commit,
      expiresAt: record.expiresAt,
      parentOrigin,
    });
    const latest = await this.record(id);
    if (latest.status !== "ready" || owner(latest).runId !== owner(record).runId)
      throw new Error("The workspace stopped while opening the view.");
    if (!response.view) throw new Error("Workspace views are unavailable.");
    if (response.view.kind !== "error" && latest.idleSince !== undefined)
      await this.patch(latest, { idleSince: Date.now() });
    return response.view;
  }
  async stop(id: string): Promise<string> {
    return this.storage.transaction(async (storage) => {
      const record = await storage.get(`workspace:${id}`);
      if (!record) throw new Error("Workspace not found.");
      if (record.status === "stopped") return owner(record).runId;
      await storage.put(`workspace:${id}`, {
        ...record,
        status: "stopping",
        terminalStatus: "stopped",
        error: null,
        retryAt: 0,
        attempts: 0,
        stopRequestedAt: record.stopRequestedAt || Date.now(),
      });
      await storage.setAlarm(Date.now() + 100);
      return owner(record).runId;
    });
  }
  private async synchronize(record: WorkspaceRecord) {
    const runId = owner(record).runId;
    const existing = this.syncs.get(runId);
    if (existing) return existing;
    const operation = (async () => {
      let saved = await this.dependencies.sessions.read(owner(record), Number.MAX_SAFE_INTEGER);
      for (let page = 0; page < 20; page++) {
        const cursor = saved.head ?? saved.cursor;
        const response = await this.dependencies
          .provider(record.id)
          .execute({ action: "sync", name: sandboxName(record), cursor, acknowledge: cursor });
        if (!response.running) return null;
        if (!response.agent) throw new Error("Agent journal is unavailable.");
        await this.dependencies.sessions.saveEvents(owner(record), response.agent);
        saved = response.agent;
        if ((saved.head ?? saved.cursor) <= saved.cursor) return saved;
        // Read the committed cursor, never acknowledge a batch merely because it was received.
        saved = await this.dependencies.sessions.read(owner(record), Number.MAX_SAFE_INTEGER);
      }
      return saved;
    })();
    this.syncs.set(runId, operation);
    try {
      return await operation;
    } finally {
      if (this.syncs.get(runId) === operation) this.syncs.delete(runId);
    }
  }
  private async capture(record: WorkspaceRecord) {
    const runId = owner(record).runId;
    const existing = this.captures.get(runId);
    if (existing) return existing;
    const operation = (async () => {
      const provider = this.dependencies.provider(record.id);
      if (!provider.checkpoint) throw new Error("Workspace checkpoint storage is unavailable.");
      const archive = await provider.checkpoint({
        name: sandboxName(record),
        id: crypto.randomUUID(),
      });
      let checkpoint: SavedCheckpoint | undefined;
      try {
        checkpoint = await this.dependencies.checkpoints.put(owner(record), archive);
        await this.synchronize(record);
        await this.dependencies.sessions.saveCheckpoint(owner(record), checkpoint);
      } catch (error) {
        if (checkpoint) await this.dependencies.checkpoints.delete(checkpoint);
        throw error;
      }
      await this.patch(record, {
        checkpointAt: checkpoint.metadata.createdAt,
        checkpointCursor: checkpoint.metadata.cursor,
        canResume: true,
      });
      // Keep three successful versions. Failed uploads never replace the last good DB pointer.
      const checkpoints = await this.dependencies.sessions.checkpoints(owner(record));
      await Promise.all(
        checkpoints.slice(3).map(async (old) => {
          await this.dependencies.checkpoints.delete(old);
          await this.dependencies.sessions.deleteCheckpoint(owner(record), old.metadata.id);
        }),
      );
    })();
    this.captures.set(runId, operation);
    try {
      return await operation;
    } finally {
      if (this.captures.get(runId) === operation) this.captures.delete(runId);
    }
  }
  private async restoreBrowser(record: WorkspaceRecord) {
    if (record.browserReady) return;
    await this.runBrowserOperation(async () => {
      const current = await this.record(record.id);
      if (current.browserReady || current.status === "stopping") return;
      const provider = this.dependencies.provider(current.id);
      const seed = await this.dependencies.browserProfiles.seed(
        browserOwner(current),
        current.repository.name,
      );
      await this.patch(current, {
        browserLease: seed.lease,
        browserSaveBlocked: false,
        browserSessionError: null,
      });
      if (seed.profile) {
        if (!provider.restoreBrowser)
          throw new Error("Cloud-browser session restoration is unavailable.");
        const body = await this.dependencies.browserProfiles.read(
          browserOwner(current),
          seed.profile,
        );
        await provider.restoreBrowser(
          { name: sandboxName(current), profile: seed.profile.metadata },
          body,
        );
        const latest = await this.dependencies.browserProfiles.seed(
          browserOwner(current),
          current.repository.name,
        );
        if (
          latest.lease.generation !== seed.lease.generation ||
          latest.lease.revision !== seed.lease.revision ||
          latest.profile?.key !== seed.profile.key
        )
          throw new Error("Saved cloud-browser session changed during restoration.");
      }
      await this.patch(current, {
        browserReady: true,
        browserProfileAt: seed.profile?.updatedAt ?? Date.now(),
      });
    });
  }

  private async captureBrowser(record: WorkspaceRecord) {
    if (!record.browserReady || record.browserSaveBlocked) return;
    await this.runBrowserOperation(async () => {
      const current = await this.record(record.id);
      if (
        !current.browserReady ||
        current.browserSaveBlocked ||
        current.status === "stopped" ||
        current.status === "failed"
      )
        return;
      const provider = this.dependencies.provider(current.id);
      if (!provider.captureBrowser) throw new Error("Cloud-browser session saving is unavailable.");
      const lease = current.browserLease;
      if (!lease) throw new Error("Cloud-browser session ownership is unavailable.");

      try {
        const archive = await provider.captureBrowser({
          name: sandboxName(current),
          id: crypto.randomUUID(),
        });
        if (!archive) {
          await this.patch(current, { browserProfileAt: Date.now(), browserSessionError: null });
          return;
        }
        const saved = await this.dependencies.browserProfiles.publish(
          browserOwner(current),
          current.repository.name,
          lease,
          archive,
        );
        await this.patch(current, {
          browserLease: { generation: saved.generation, revision: saved.revision },
          browserProfileAt: saved.updatedAt,
          browserSessionError: null,
        });
      } catch (error) {
        const message =
          error instanceof BrowserProfileConflictError
            ? "Browser changes from this workspace were not saved because a newer session already exists for this project."
            : "Cloud-browser session saving failed. The last successful saved session is preserved.";
        await this.dependencies.browserProfiles.error(browserOwner(current), message);
        await this.patch(current, {
          browserSaveBlocked: error instanceof BrowserProfileConflictError,
          browserSessionError: message,
        });
        if (!(error instanceof BrowserProfileConflictError)) throw error;
      }
    });
  }
  private async provision(record: WorkspaceRecord) {
    const provider = this.dependencies.provider(record.id);
    const repository = await this.dependencies.authorize(record.userId, record.repository);
    await this.dependencies.sessions.ensure(owner(record));
    if (record.restoring) await this.dependencies.sessions.beginRun(owner(record));
    if (!record.phase || record.phase === "sandbox") {
      await provider.execute({ action: "allocate", name: sandboxName(record), repository });
      if ((await this.record(record.id)).status === "stopping") return;
      await this.patch(record, { phase: "checkout" });
    }
    let result;
    if (record.restoring) {
      if (!record.restoreCheckpoint || !provider.restore)
        throw new Error("Workspace restoration is unavailable.");
      const history = await this.dependencies.sessions.read(owner(record), Number.MAX_SAFE_INTEGER);
      const body = await this.dependencies.checkpoints.get(owner(record), record.restoreCheckpoint);
      await provider.restore(
        {
          name: sandboxName(record),
          checkpoint: record.restoreCheckpoint.metadata,
          cursor: history.head ?? history.cursor,
        },
        body,
      );
      if ((await this.record(record.id)).status === "stopping") return;
      await this.restoreBrowser(record);
      if ((await this.record(record.id)).status === "stopping") return;
      result = await provider.execute({ action: "start", name: sandboxName(record) });
    } else {
      const token = await this.dependencies.checkoutToken(repository);
      try {
        if ((await this.record(record.id)).status === "stopping") return;
        result = await provider.execute({
          action: "create",
          name: sandboxName(record),
          repository,
          token,
        });
        if ((await this.record(record.id)).status === "stopping") return;
        await this.restoreBrowser(record);
      } finally {
        await this.dependencies.revokeCheckoutToken?.(token);
      }
    }
    if ((await this.record(record.id)).status === "stopping") return;
    await this.patch(record, {
      repository,
      sandboxId: result.sandboxId,
      commit: result.commit || record.commit,
      status: "ready",
      phase: "agent",
      restoring: false,
      restoreCheckpoint: undefined,
      error: null,
      attempts: 0,
      retryAt: Date.now() + 1000,
    });
  }
  private async ready(record: WorkspaceRecord) {
    await this.dependencies.sessions.ensure(owner(record));
    const snapshot = await this.synchronize(record);
    if (!snapshot) {
      await this.dependencies.sessions.finish(owner(record), true);
      await this.patch(record, {
        status: "stopped",
        error:
          "The sandbox stopped unexpectedly. The saved conversation and latest checkpoint are available.",
      });
      return;
    }
    if (!record.browserProfileAt || record.browserProfileAt + checkpointIntervalMs <= Date.now())
      await this.captureBrowser(record);
    if (record.pendingPrompt && snapshot.status === "idle" && record.agentStarted) {
      await this.dependencies.sessions.reservePrompt(owner(record), record.pendingPrompt);
      await this.dependencies.provider(record.id).execute({
        action: "agent",
        name: sandboxName(record),
        command: record.pendingPrompt,
      });
      await this.patch(record, {
        pendingPrompt: undefined,
        idleSince: undefined,
        phase: "task",
        retryAt: Date.now() + 1000,
      });
      return;
    }
    if (record.agentStarted && ["idle", "failed", "interrupted"].includes(snapshot.status)) {
      if (record.idleSince === undefined) {
        await this.patch(record, { idleSince: Date.now() });
      } else if (Date.now() - record.idleSince >= workspaceIdleTimeoutMs) {
        await this.storage.transaction(async (storage) => {
          const current = await storage.get(`workspace:${record.id}`);
          if (
            current?.status !== "ready" ||
            owner(current).runId !== owner(record).runId ||
            current.idleSince !== record.idleSince
          )
            return;
          await storage.put(`workspace:${record.id}`, {
            ...current,
            status: "stopping",
            terminalStatus: "stopped",
            stopRequestedAt: Date.now(),
            retryAt: 0,
          });
        });
        return;
      }
    } else if (record.idleSince !== undefined) {
      await this.patch(record, { idleSince: undefined });
    }
    if (!record.agentStarted && snapshot.status === "idle") {
      if (!record.checkpointAt) await this.capture(record);
      if ((await this.record(record.id)).status === "stopping") return;
      const command = { kind: "prompt" as const, requestId: record.id, prompt: record.prompt };
      await this.dependencies.sessions.reservePrompt(owner(record), command);
      if ((await this.record(record.id)).status !== "ready") return;
      await this.dependencies
        .provider(record.id)
        .execute({ action: "agent", name: sandboxName(record), command });
      await this.patch(record, { agentStarted: true, phase: "task" });
    } else if (
      snapshot.status === "idle" &&
      ((record.checkpointCursor ?? -1) < snapshot.cursor ||
        (record.checkpointAt ?? 0) + checkpointIntervalMs <= Date.now())
    ) {
      await this.capture(record);
    }
    if (record.agentStarted && snapshot.status === "idle")
      await this.patch(record, { phase: "task" });
    await this.patch(record, { retryAt: Date.now() + 2000, error: null, attempts: 0 });
  }
  private async stopping(record: WorkspaceRecord) {
    const provider = this.dependencies.provider(record.id);
    await this.dependencies.sessions.ensure(owner(record));
    if (record.agentStarted && !record.restoring) {
      const snapshot = await this.synchronize(record);
      if (snapshot?.status === "running") {
        await provider.execute({
          action: "agent",
          name: sandboxName(record),
          command: { kind: "cancel" },
        });
        if (Date.now() - (record.stopRequestedAt || Date.now()) < 30_000) {
          await this.patch(record, { retryAt: Date.now() + 1000 });
          return;
        }
        await this.captureBrowser(record).catch(() => {});
        await provider.execute({ action: "stop", name: sandboxName(record) });
        await this.dependencies.sessions.finish(owner(record), true);
        await this.patch(record, {
          status: record.terminalStatus,
          error: "The agent did not stop cleanly. Its last successful checkpoint is available.",
        });
        return;
      }
      if (snapshot && ["idle", "failed"].includes(snapshot.status)) await this.capture(record);
      if (snapshot?.status === "checkpointing" || snapshot?.status === "starting") {
        await this.patch(record, { retryAt: Date.now() + 1000 });
        return;
      }
    }
    await this.captureBrowser(record).catch(() => {});
    await provider.execute({ action: "stop", name: sandboxName(record) });
    await this.dependencies.sessions.finish(owner(record), record.terminalStatus === "failed");
    await this.patch(record, {
      status: record.terminalStatus,
      restoring: false,
      error:
        record.terminalStatus === "failed"
          ? "Workspace setup failed. Saved history and earlier checkpoints are preserved."
          : null,
    });
  }
  async alarm(): Promise<void> {
    // Schedule before external I/O so a worker restart cannot strand an active task.
    await this.storage.setAlarm(Date.now() + 2000);
    for (const saved of (await this.storage.list()).values()) {
      let record = await this.record(saved.id);
      if (terminal(record)) {
        if (record.pendingPrompt && record.status === "stopped") await this.resume(record.id);
        continue;
      }
      if (
        record.retryAt > Date.now() &&
        !(record.status === "ready" && record.expiresAt <= Date.now())
      )
        continue;
      try {
        if (record.expiresAt <= Date.now() && record.status !== "stopping") {
          await this.patch(record, { status: "stopping", stopRequestedAt: Date.now() });
          record = await this.record(record.id);
        }
        if (record.status === "stopping") await this.stopping(record);
        else if (record.status === "ready") await this.ready(record);
        else {
          await this.provision(record);
          const latest = await this.record(record.id);
          if (latest.status === "stopping") await this.stopping(latest);
        }
      } catch {
        const latest = await this.record(record.id);
        const attempts = latest.attempts + 1;
        const failedSetup = latest.status === "provisioning" && attempts >= 3;
        await this.patch(latest, {
          attempts,
          retryAt: Date.now() + Math.min(60_000, 2000 * 2 ** Math.min(attempts - 1, 5)),
          status: failedSetup ? "stopping" : latest.status,
          terminalStatus: failedSetup ? "failed" : latest.terminalStatus,
          error:
            latest.status === "ready" || latest.status === "stopping"
              ? "Saving or contacting the workspace failed. Retrying; the last successful checkpoint is preserved."
              : "Workspace setup could not finish. Retrying automatically.",
        });
      }
    }
    await this.storage.transaction(async (storage) => {
      const active = [...(await storage.list()).values()].filter(
        (record) => !terminal(record) || (record.status === "stopped" && record.pendingPrompt),
      );
      if (active.length)
        await storage.setAlarm(
          Math.max(
            Date.now() + 100,
            Math.min(
              ...active.map((record) =>
                record.status === "ready"
                  ? Math.min(record.expiresAt, record.retryAt)
                  : record.retryAt,
              ),
            ),
          ),
        );
      else await storage.deleteAlarm();
    });
  }
}
