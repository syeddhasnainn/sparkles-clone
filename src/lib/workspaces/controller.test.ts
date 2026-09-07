import { describe, expect, it, vi } from "vitest";
import type { SavedCheckpoint, SessionStore } from "./session-store";
import { WorkspaceController } from "./controller";
import type { WorkspaceDependencies, WorkspaceRecord, WorkspaceStorage } from "./controller";
import type { AgentSnapshot, CreateWorkspace } from "../../../bridge/contracts";
import type { BrowserProfileStore } from "./browser-profile-store";
import type { WorkspaceProvider } from "./provider.server";
import { WorkspaceBridgeVersionError } from "../../../bridge/protocol";

function harness() {
  const records = new Map<string, WorkspaceRecord>();
  const storage: WorkspaceStorage = {
    get: async (key) => structuredClone(records.get(key)),
    put: async (key, record) => {
      records.set(key, structuredClone(record));
    },
    list: async () => structuredClone(records),
    getAlarm: vi.fn(async (): Promise<number | null> => null),
    setAlarm: vi.fn(async () => {}),
    deleteAlarm: vi.fn(async () => {}),
    transaction: async (callback) => callback(storage),
  };
  const histories = new Map<string, AgentSnapshot>();
  const backups = new Map<string, SavedCheckpoint[]>();
  const sessions: SessionStore = {
    ensure: async (owner) => {
      if (!histories.has(owner.taskId))
        histories.set(owner.taskId, { status: "starting", events: [], cursor: 0, head: 0 });
    },
    beginRun: async (owner) => {
      histories.get(owner.taskId)!.status = "starting";
    },
    read: async (owner, cursor, options) => {
      const state = histories.get(owner.taskId)!;
      const events = state.events
        .filter((event) => event.id > cursor && event.id <= state.cursor)
        .slice(0, options?.all ? undefined : 100);
      return {
        ...state,
        events,
        cursor: events.at(-1)?.id ?? Math.min(cursor, state.cursor),
        head: state.cursor,
      };
    },
    saveEvents: async (owner, snapshot) => {
      const state = histories.get(owner.taskId)!;
      histories.set(owner.taskId, {
        ...snapshot,
        events: [...state.events, ...snapshot.events.filter((event) => event.id > state.cursor)],
      });
      return snapshot.cursor;
    },
    reservePrompt: vi.fn(async () => {}),
    finish: async (owner, interrupted) => {
      histories.get(owner.taskId)!.status = interrupted ? "interrupted" : "stopped";
    },
    latestCheckpoint: async (owner) => backups.get(owner.taskId)?.[0] ?? null,
    saveCheckpoint: async (owner, checkpoint) => {
      backups.set(owner.taskId, [checkpoint, ...(backups.get(owner.taskId) || [])]);
    },
    checkpoints: async (owner) => backups.get(owner.taskId) || [],
    deleteCheckpoint: async (owner, id) => {
      backups.set(
        owner.taskId,
        (backups.get(owner.taskId) || []).filter((item) => item.metadata.id !== id),
      );
    },
  };
  const execute = vi.fn<ReturnType<WorkspaceDependencies["provider"]>["execute"]>(
    async (request) => ({
      running: true,
      sandboxId: "sb-test",
      commit: "a".repeat(40),
      agent: {
        status:
          request.action === "agent" && request.command.kind === "prompt" ? "running" : "idle",
        sessionId: "test-session",
        events: [],
        cursor: request.action === "sync" ? request.cursor : 0,
        head: request.action === "sync" ? request.cursor : 0,
      },
    }),
  );
  const seedBrowser = vi.fn<BrowserProfileStore["seed"]>(async () => ({
    lease: { generation: 0, revision: 0 },
    profile: null,
  }));
  const publishBrowser = vi.fn<BrowserProfileStore["publish"]>(
    async (owner, repositoryName, expected, archive) => ({
      key: archive.metadata.id,
      repositoryId: owner.repositoryId,
      repositoryName,
      generation: expected.generation,
      revision: expected.revision + 1,
      metadata: archive.metadata,
      encryptedSize: archive.metadata.size,
      updatedAt: archive.metadata.createdAt,
    }),
  );
  const captureBrowser = vi.fn<NonNullable<WorkspaceProvider["captureBrowser"]>>(async () => null);
  const restoreBrowser = vi.fn(async () => {});
  const resetBrowser = vi.fn(async () => {});
  const clearBrowser = vi.fn<BrowserProfileStore["clear"]>(async () => ({
    generation: 1,
    cleanupPending: false,
  }));
  const dependencies: WorkspaceDependencies = {
    authorize: vi.fn(async (_userId, repository) => repository),
    checkoutToken: vi.fn(async () => "secret-token"),
    sessions,
    checkpoints: {
      put: async (_owner, archive) => ({ key: archive.metadata.id, metadata: archive.metadata }),
      get: async () => new Blob(["checkpoint"]).stream(),
      delete: async () => {},
    },
    browserProfiles: {
      seed: seedBrowser,
      publish: publishBrowser,
      read: async () => new Blob(["browser-profile"]).stream(),
      list: async () => [],
      clear: clearBrowser,
      cleanup: async () => false,
      error: async () => {},
    },
    provider: (id) => ({
      execute,
      checkpoint: async (request) => ({
        metadata: {
          id: request.id,
          sessionId: "test-session",
          cursor: histories.get(id)?.cursor || 0,
          createdAt: Date.now(),
          size: 10,
          sha256: "0".repeat(64),
          interrupted: false,
        },
        body: new Blob(["checkpoint"]).stream(),
      }),
      restore: vi.fn(async () => {}),
      captureBrowser,
      restoreBrowser,
      resetBrowser,
    }),
  };
  return {
    controller: new WorkspaceController(storage, dependencies),
    storage,
    dependencies,
    execute,
    records,
    histories,
    backups,
    seedBrowser,
    publishBrowser,
    captureBrowser,
    restoreBrowser,
    resetBrowser,
    clearBrowser,
  };
}

function input(): CreateWorkspace {
  return {
    requestId: crypto.randomUUID(),
    prompt: "Add search",
    repository: { id: 1, installationId: 2, name: "owner/repo", defaultBranch: "main" },
  };
}

describe("workspace lifecycle", () => {
  it("fails an outdated bridge once and preserves its explanation after cleanup", async () => {
    const { controller, records, execute } = harness();
    const workspace = await controller.start("user", input());
    execute.mockRejectedValueOnce(new WorkspaceBridgeVersionError());
    await controller.alarm();
    const record = records.get(`workspace:${workspace.id}`)!;
    expect(record.status).toBe("stopping");
    expect(record.attempts).toBe(1);
    record.retryAt = 0;
    await controller.alarm();
    const result = (await controller.list())[0];
    expect(result.status).toBe("failed");
    expect(result.error).toContain("workspace service is out of date");
    expect(execute.mock.calls.filter(([request]) => request.action === "allocate")).toHaveLength(1);
  });

  it("loads the complete saved conversation without waiting for client polling", async () => {
    const { controller, histories, dependencies } = harness();
    const workspace = await controller.start("user", input());
    const events = Array.from({ length: 2501 }, (_, index) => ({
      id: index + 1,
      type: "user",
      data: { text: `Message ${index + 1}` },
    }));
    histories.set(workspace.id, { status: "idle", events, cursor: 2501, head: 2501 });
    const read = vi.spyOn(dependencies.sessions, "read");
    const conversation = await controller.conversation(workspace.id);
    expect(conversation.events).toEqual(events);
    expect(conversation.cursor).toBe(2501);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0].slice(1)).toEqual([0, { all: true }]);
  });

  it("recovers a missing alarm and reconciles expired ready tasks when listing", async () => {
    const { controller, storage, records } = harness();
    const workspace = await controller.start("user", input());
    await controller.alarm();
    const record = records.get(`workspace:${workspace.id}`)!;
    record.expiresAt = Date.now() - 1000;
    vi.mocked(storage.setAlarm).mockClear();

    expect((await controller.list())[0].status).toBe("stopping");
    expect(records.get(`workspace:${workspace.id}`)?.stopRequestedAt).toBeGreaterThan(0);
    expect(storage.setAlarm).toHaveBeenCalledTimes(1);
    await controller.alarm();
    expect((await controller.list())[0].status).toBe("stopped");
  });

  it("does not postpone an existing alarm or wake completed tasks when listing", async () => {
    const { controller, storage, records } = harness();
    const workspace = await controller.start("user", input());
    vi.mocked(storage.getAlarm).mockResolvedValue(Date.now() + 1000);
    vi.mocked(storage.setAlarm).mockClear();
    await controller.list();
    expect(storage.setAlarm).not.toHaveBeenCalled();
    records.get(`workspace:${workspace.id}`)!.status = "stopped";
    vi.mocked(storage.getAlarm).mockResolvedValue(null);
    await controller.list();
    expect(storage.setAlarm).not.toHaveBeenCalled();
  });

  it("restores a project browser profile after checkout and before the first task", async () => {
    const harnessed = harness();
    const metadata = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      size: 15,
      sha256: "1".repeat(64),
    };
    harnessed.seedBrowser.mockResolvedValue({
      lease: { generation: 2, revision: 4 },
      profile: {
        key: "saved-profile",
        repositoryId: 1,
        repositoryName: "owner/repo",
        generation: 2,
        revision: 4,
        metadata,
        encryptedSize: 31,
        updatedAt: metadata.createdAt,
      },
    });

    await harnessed.controller.start("owner", input());
    await harnessed.controller.alarm();

    const createCall = harnessed.execute.mock.calls.findIndex(
      ([request]) => request.action === "create",
    );
    expect(createCall).toBeGreaterThanOrEqual(0);
    expect(harnessed.restoreBrowser).toHaveBeenCalledWith(
      expect.objectContaining({ profile: metadata }),
      expect.any(ReadableStream),
    );
    expect(harnessed.execute.mock.invocationCallOrder[createCall]).toBeLessThan(
      harnessed.restoreBrowser.mock.invocationCallOrder[0],
    );
    expect(harnessed.histories.values().next().value?.status).toBe("starting");
  });

  it("captures browser changes while the agent is running", async () => {
    const harnessed = harness();
    const task = await harnessed.controller.start("owner", input());
    await harnessed.controller.alarm();
    const record = harnessed.records.get(`workspace:${task.id}`)!;
    harnessed.records.set(`workspace:${task.id}`, {
      ...record,
      agentStarted: true,
      browserProfileAt: 0,
      retryAt: 0,
    });
    harnessed.histories.set(task.id, {
      status: "running",
      sessionId: "test-session",
      events: [],
      cursor: 0,
      head: 0,
    });
    harnessed.captureBrowser.mockResolvedValueOnce({
      metadata: {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        size: 1,
        sha256: "2".repeat(64),
      },
      body: new Blob(["x"]).stream(),
    });

    await harnessed.controller.alarm();

    expect(harnessed.captureBrowser).toHaveBeenCalledOnce();
    expect(harnessed.publishBrowser).toHaveBeenCalledOnce();
    expect(harnessed.records.get(`workspace:${task.id}`)?.browserLease?.revision).toBe(1);
  });

  it("does not publish a profile when the cloud browser was never opened", async () => {
    const harnessed = harness();
    const task = await harnessed.controller.start("owner", input());
    await harnessed.controller.alarm();
    const record = harnessed.records.get(`workspace:${task.id}`)!;
    harnessed.records.set(`workspace:${task.id}`, {
      ...record,
      browserProfileAt: 0,
      retryAt: 0,
    });

    await harnessed.controller.alarm();

    expect(harnessed.captureBrowser).toHaveBeenCalledOnce();
    expect(harnessed.publishBrowser).not.toHaveBeenCalled();
    expect(harnessed.records.get(`workspace:${task.id}`)?.browserProfileAt).toBeGreaterThan(0);
  });

  it("fences saving until every live browser is reset after clear", async () => {
    const harnessed = harness();
    const task = await harnessed.controller.start("owner", input());
    await harnessed.controller.alarm();
    harnessed.resetBrowser.mockRejectedValueOnce(new Error("reset failed"));

    await expect(harnessed.controller.clearBrowserSessions("owner")).rejects.toThrow(
      "running cloud browser",
    );
    expect(harnessed.records.get(`workspace:${task.id}`)?.browserSaveBlocked).toBe(true);

    await harnessed.controller.clearBrowserSessions("owner");
    expect(harnessed.records.get(`workspace:${task.id}`)?.browserSaveBlocked).toBe(false);
    expect(harnessed.resetBrowser).toHaveBeenCalledTimes(2);
  });

  it("authorizes view access and binds commands to the current sandbox generation", async () => {
    const { controller, execute, dependencies } = harness();
    const task = await controller.start("owner", input());
    await controller.alarm();
    execute.mockResolvedValueOnce({
      running: true,
      sandboxId: "sb-test",
      commit: null,
      view: { kind: "files", files: [], truncated: false },
    });
    await expect(
      controller.view(
        task.id,
        { kind: "files", scope: "changed", base: "task" },
        "https://app.example",
      ),
    ).resolves.toMatchObject({ kind: "files" });
    expect(dependencies.authorize).toHaveBeenCalledWith("owner", task.repository);
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "view",
        name: `sparkles-${task.id}`,
        commit: "a".repeat(40),
      }),
    );
    await controller.stop(task.id);
    await expect(
      controller.view(task.id, { kind: "services" }, "https://app.example"),
    ).rejects.toThrow("Resume");
  });

  it("discards a view response if the workspace stops while it is loading", async () => {
    const { controller, execute } = harness();
    const task = await controller.start("owner", input());
    await controller.alarm();
    execute.mockImplementationOnce(async () => {
      await controller.stop(task.id);
      return {
        running: true,
        sandboxId: "sb-test",
        commit: null,
        view: { kind: "files", files: [], truncated: false },
      };
    });
    await expect(
      controller.view(
        task.id,
        { kind: "files", scope: "all", base: "task" },
        "https://app.example",
      ),
    ).rejects.toThrow("stopped while opening");
  });

  it("deduplicates a request and limits simultaneous workspaces", async () => {
    const { controller } = harness();
    const request = input();
    const first = await controller.start("user", request);
    expect(await controller.start("user", request)).toEqual(first);
    await controller.start("user", input());
    await controller.start("user", input());
    await expect(controller.start("user", input())).rejects.toThrow("three");
    expect(await controller.list()).toHaveLength(3);
  });

  it("reauthorizes before checkout and never persists or returns credentials", async () => {
    const { controller, records, dependencies } = harness();
    await controller.start("user", input());
    await controller.alarm();
    expect(dependencies.authorize).toHaveBeenCalledWith("user", expect.objectContaining({ id: 1 }));
    const [workspace] = await controller.list();
    expect(workspace.status).toBe("ready");
    expect(workspace).not.toHaveProperty("userId");
    expect(JSON.stringify([...records.values()])).not.toContain("secret-token");
  });

  it("honors cancellation received while provisioning is in flight", async () => {
    const { controller, execute } = harness();
    const workspace = await controller.start("user", input());
    execute.mockImplementationOnce(async () => {
      await controller.stop(workspace.id);
      return { running: true, sandboxId: "sb-test", commit: null };
    });
    await controller.alarm();
    expect(execute).toHaveBeenLastCalledWith({ action: "stop", name: `sparkles-${workspace.id}` });
    expect((await controller.list())[0].status).toBe("stopped");
  });

  it("cleans up a possibly created sandbox after repeated errors", async () => {
    const { controller, execute, records } = harness();
    await controller.start("user", input());
    execute.mockRejectedValueOnce(new Error("provider secret detail"));
    execute.mockRejectedValueOnce(new Error("provider secret detail"));
    execute.mockRejectedValueOnce(new Error("provider secret detail"));
    await controller.alarm();
    for (const record of records.values()) record.retryAt = 0;
    await controller.alarm();
    for (const record of records.values()) record.retryAt = 0;
    await controller.alarm();
    expect((await controller.list())[0].status).toBe("stopping");
    for (const record of records.values()) record.retryAt = 0;
    await controller.alarm();
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ action: "stop" }));
    expect((await controller.list())[0].status).toBe("failed");
    expect(JSON.stringify(await controller.list())).not.toContain("provider secret detail");
  });

  it("does not create a sandbox when repository access was revoked", async () => {
    const { controller, dependencies, execute } = harness();
    await controller.start("user", input());
    dependencies.authorize = async () => {
      throw new Error("access revoked");
    };
    await controller.alarm();
    expect(execute).not.toHaveBeenCalled();
    expect(dependencies.checkoutToken).not.toHaveBeenCalled();
  });

  it("stops expired workspaces and rejects unknown workspace IDs", async () => {
    const { controller, records, execute } = harness();
    const workspace = await controller.start("user", input());
    await controller.alarm();
    records.get(`workspace:${workspace.id}`)!.expiresAt = 0;
    await controller.alarm();
    expect(execute).toHaveBeenLastCalledWith({ action: "stop", name: `sparkles-${workspace.id}` });
    expect((await controller.list())[0].status).toBe("stopped");
    await expect(controller.stop(crypto.randomUUID())).rejects.toThrow("not found");
  });

  it("backs off retries instead of repeatedly creating during an outage", async () => {
    const { controller, execute } = harness();
    await controller.start("user", input());
    execute.mockRejectedValue(new Error("offline"));
    await controller.alarm();
    await controller.alarm();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("reconciles externally terminated sandboxes without recreating them", async () => {
    const { controller, execute, records } = harness();
    await controller.start("user", input());
    await controller.alarm();
    for (const record of records.values()) {
      record.retryAt = 0;
      record.agentStarted = true;
    }
    execute.mockResolvedValueOnce({ running: false, sandboxId: null, commit: null });
    await controller.alarm();
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ action: "sync" }));
    expect((await controller.list())[0].status).toBe("stopped");
  });

  it("keeps a ready workspace when a status check fails", async () => {
    const { controller, execute, records } = harness();
    await controller.start("user", input());
    await controller.alarm();
    for (const record of records.values()) {
      record.retryAt = 0;
      record.agentStarted = true;
    }
    execute.mockRejectedValueOnce(new Error("offline"));
    await controller.alarm();
    expect((await controller.list())[0].status).toBe("ready");
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ action: "sync" }));
  });
  it("submits the saved prompt once after checkout is ready", async () => {
    const { controller, execute, records } = harness();
    const request = input();
    const workspace = await controller.start("user", request);
    await controller.alarm();
    for (const record of records.values()) record.retryAt = 0;
    await controller.alarm();
    expect(execute).toHaveBeenLastCalledWith({
      action: "agent",
      name: `sparkles-${workspace.id}`,
      command: { kind: "prompt", requestId: workspace.id, prompt: request.prompt },
    });
    for (const record of records.values()) record.retryAt = 0;
    await controller.alarm();
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "sync", name: `sparkles-${workspace.id}` }),
    );
  });

  it("rejects agent commands for a missing or unready workspace", async () => {
    const { controller, execute } = harness();
    await expect(
      controller.agent(crypto.randomUUID(), { kind: "events", cursor: 0 }),
    ).rejects.toThrow("not found");
    const workspace = await controller.start("user", input());
    await expect(controller.agent(workspace.id, { kind: "cancel" })).rejects.toThrow("not ready");
    expect(execute).not.toHaveBeenCalled();
  });

  it("revokes checkout credentials even when checkout fails", async () => {
    const { controller, dependencies, execute } = harness();
    dependencies.revokeCheckoutToken = vi.fn(async () => {});
    await controller.start("user", input());
    execute.mockImplementation(async (request) => {
      if (request.action === "create") throw new Error("Checkout failed");
      return { running: true, sandboxId: "sb-test", commit: null };
    });
    await controller.alarm();
    expect(dependencies.revokeCheckoutToken).toHaveBeenCalledWith("secret-token");
  });
  it("restores a stopped task in a fresh run without replaying the original prompt", async () => {
    const { controller, records, execute, dependencies, backups } = harness();
    const task = await controller.start("user", input());
    await controller.alarm();
    records.get(`workspace:${task.id}`)!.retryAt = 0;
    await controller.alarm();
    expect(backups.get(task.id)).toHaveLength(1);
    await controller.stop(task.id);
    await controller.alarm();
    expect((await controller.agent(task.id, { kind: "events", cursor: 0 })).status).toBe("stopped");
    expect((await controller.list())[0].canResume).toBe(true);
    execute.mockClear();
    const restore = vi.fn(async () => {});
    const originalProvider = dependencies.provider;
    dependencies.provider = (id) => ({ ...originalProvider(id), restore });
    await controller.resume(task.id);
    const runId = records.get(`workspace:${task.id}`)!.runId;
    expect(runId).not.toBe(task.id);
    await controller.alarm();
    expect(restore).toHaveBeenCalledWith(
      expect.objectContaining({ name: `sparkles-${runId}` }),
      expect.any(ReadableStream),
    );
    expect(execute).toHaveBeenCalledWith({
      action: "start",
      name: `sparkles-${runId}`,
      repository: task.repository,
    });
    expect(execute.mock.calls.some(([request]) => request.action === "agent")).toBe(false);
    expect((await controller.list())[0].status).toBe("ready");
  });

  it("retains the last checkpoint and retries when a subsequent upload fails", async () => {
    const { controller, records, dependencies, backups } = harness();
    const task = await controller.start("user", input());
    await controller.alarm();
    records.get(`workspace:${task.id}`)!.retryAt = 0;
    await controller.alarm();
    const checkpoint = backups.get(task.id)![0];
    dependencies.checkpoints.put = vi.fn(async () => {
      throw new Error("upload interrupted");
    });
    await controller.stop(task.id);
    await controller.alarm();
    expect(backups.get(task.id)).toEqual([checkpoint]);
    expect((await controller.list())[0]).toMatchObject({ status: "stopping", canResume: true });
    expect(records.get(`workspace:${task.id}`)!.retryAt).toBeGreaterThan(Date.now());
  });
  it("terminates an unsuccessful restore without waiting for a runner that never started", async () => {
    const { controller, records, execute } = harness();
    const task = await controller.start("user", input());
    const record = records.get(`workspace:${task.id}`)!;
    Object.assign(record, {
      status: "stopping",
      restoring: true,
      agentStarted: true,
      terminalStatus: "failed",
    });
    await controller.alarm();
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      action: "stop",
      name: `sparkles-${task.id}`,
    });
    expect((await controller.list())[0].status).toBe("failed");
  });
});

it("keeps a workspace for nine idle minutes and checkpoints it after ten", async () => {
  const { controller, records, execute } = harness();
  const task = await controller.start("user", input());
  await controller.alarm();
  const record = records.get(`workspace:${task.id}`)!;
  record.agentStarted = true;
  record.idleSince = Date.now() - 9 * 60_000;
  record.retryAt = 0;
  await controller.alarm();
  expect(records.get(`workspace:${task.id}`)?.status).toBe("ready");
  const current = records.get(`workspace:${task.id}`)!;
  current.idleSince = Date.now() - 600_001;
  current.retryAt = 0;
  await controller.alarm();
  expect(records.get(`workspace:${task.id}`)?.status).toBe("stopping");
  await controller.alarm();
  expect(execute).toHaveBeenCalledWith({ action: "stop", name: `sparkles-${task.id}` });
  expect(records.get(`workspace:${task.id}`)?.canResume).toBe(true);
});

it("keeps a workspace alive while its preview is being viewed", async () => {
  const { controller, records, execute } = harness();
  const task = await controller.start("user", input());
  await controller.alarm();
  const record = records.get(`workspace:${task.id}`)!;
  record.agentStarted = true;
  record.idleSince = Date.now() - 600_001;
  record.retryAt = 0;
  execute.mockResolvedValueOnce({
    running: true,
    sandboxId: "sb-test",
    commit: record.commit,
    view: {
      kind: "services",
      preview: { status: "ready", command: "pnpm run dev", port: 3000, managed: true, log: "" },
      desktop: { status: "stopped", log: "" },
    },
  });
  await controller.view(task.id, { kind: "services" }, "https://app.example");
  await controller.alarm();
  expect((await controller.list())[0].status).toBe("ready");
  expect(Date.now() - records.get(`workspace:${task.id}`)!.idleSince!).toBeLessThan(60_000);
});

it("keeps an active agent alive beyond the idle timeout", async () => {
  const { controller, records, execute } = harness();
  const task = await controller.start("user", input());
  await controller.alarm();
  const record = records.get(`workspace:${task.id}`)!;
  record.agentStarted = true;
  record.idleSince = Date.now() - 600_001;
  record.retryAt = 0;
  execute.mockResolvedValue({
    running: true,
    sandboxId: "sb-test",
    commit: null,
    agent: { status: "running", events: [], cursor: 0, head: 0 },
  });
  await controller.alarm();
  expect(records.get(`workspace:${task.id}`)?.status).toBe("ready");
  expect(records.get(`workspace:${task.id}`)?.idleSince).toBeUndefined();
});

it("automatically restores a stopped workspace and delivers its queued prompt once", async () => {
  const { controller, records, execute } = harness();
  const task = await controller.start("user", input());
  await controller.alarm();
  records.get(`workspace:${task.id}`)!.retryAt = 0;
  await controller.alarm();
  await controller.stop(task.id);
  await controller.alarm();
  expect(records.get(`workspace:${task.id}`)?.status).toBe("stopped");
  const command = {
    kind: "prompt" as const,
    requestId: crypto.randomUUID(),
    prompt: "Continue please",
  };
  await controller.agent(task.id, command);
  expect(records.get(`workspace:${task.id}`)?.status).toBe("provisioning");
  expect(records.get(`workspace:${task.id}`)?.pendingPrompt).toEqual(command);
  await controller.alarm();
  records.get(`workspace:${task.id}`)!.retryAt = 0;
  await controller.alarm();
  expect(records.get(`workspace:${task.id}`)?.pendingPrompt).toBeUndefined();
  expect(
    execute.mock.calls.filter(
      ([request]) =>
        request.action === "agent" &&
        request.command.kind === "prompt" &&
        request.command.requestId === command.requestId,
    ),
  ).toHaveLength(1);
});
