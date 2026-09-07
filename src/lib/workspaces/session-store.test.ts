import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createSessionStore } from "./session-store";
import type { SessionOwner } from "./session-store";
import type { AgentSnapshot } from "../../../bridge/contracts";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('test'); } }",
    compatibilityDate: "2026-09-06",
    d1Databases: ["DB"],
  }),
);
const db = await runtime.getD1Database("DB");
const store = createSessionStore(db);
const owner: SessionOwner = { taskId: "task-a", userId: "user-a", runId: "run-a" };
const snapshot = (status: AgentSnapshot["status"] = "idle"): AgentSnapshot => ({
  status,
  sessionId: "session-a",
  cursor: 2,
  head: 2,
  events: [
    { id: 1, type: "user", data: { text: "Build a thing" } },
    {
      id: 2,
      type: "update",
      data: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done" } },
    },
  ],
});
beforeAll(async () => {
  for (const migration of [
    "0002_agent_sessions.sql",
    "0003_model_gateway.sql",
    "0004_chatgpt_connections.sql",
  ]) {
    const sql = await readFile(
      new URL(`../../../migrations/${migration}`, import.meta.url),
      "utf8",
    );
    for (const statement of sql.split(";").filter((statement) => statement.trim()))
      await db.prepare(statement).run();
  }
});
beforeEach(async () => {
  await db.prepare("DELETE FROM agent_sessions").run();
  await store.ensure(owner);
});
afterAll(() => runtime.dispose());

describe("durable agent sessions", () => {
  it("reads the entire initial history beyond the former page limit", async () => {
    const events = Array.from({ length: 1001 }, (_, index) => ({
      id: index + 1,
      type: "user",
      data: { text: `Message ${index + 1}` },
    }));
    await db.batch([
      db
        .prepare(
          "INSERT INTO agent_events(task_id, event_id, run_id, type, payload, created_at) SELECT ?, json_extract(value, '$.id'), ?, json_extract(value, '$.type'), json_extract(value, '$.data'), ? FROM json_each(?)",
        )
        .bind(owner.taskId, owner.runId, Date.now(), JSON.stringify(events)),
      db
        .prepare("UPDATE agent_sessions SET cursor = ? WHERE task_id = ?")
        .bind(events.length, owner.taskId),
    ]);
    expect((await store.read(owner, 0)).events).toHaveLength(100);
    const history = await store.read(owner, 0, { all: true });
    expect(history.events).toEqual(events);
    expect(history.cursor).toBe(1001);
    expect(history.head).toBe(1001);
    await expect(store.read({ ...owner, userId: "other" }, 0, { all: true })).rejects.toThrow(
      "not found",
    );
  });

  it("preserves ordered history after stopping and reconstructing the store", async () => {
    await store.saveEvents(owner, snapshot());
    await store.finish(owner, false);
    const recovered = await createSessionStore(db).read(owner, 0);
    expect(recovered.events.map((event) => event.id)).toEqual([1, 2, 3]);
    expect(recovered.events[0].data.text).toBe("Build a thing");
    expect(recovered.status).toBe("stopped");
    expect(recovered.sessionId).toBe("session-a");
  });
  it("deduplicates retried batches and only acknowledges a contiguous journal", async () => {
    expect(await store.saveEvents(owner, snapshot())).toBe(2);
    expect(await store.saveEvents(owner, snapshot())).toBe(2);
    await expect(
      store.saveEvents(owner, {
        status: "idle",
        cursor: 4,
        events: [{ id: 4, type: "complete", data: {} }],
      }),
    ).rejects.toThrow("gap");
    await expect(
      store.saveEvents(owner, { status: "idle", cursor: 3, events: [] }),
    ).rejects.toThrow("unsaved");
    expect((await store.read(owner, 0)).events).toHaveLength(2);
  });
  it("blocks another owner from reading or replacing the session", async () => {
    const attacker = { ...owner, userId: "user-b" };
    await expect(store.read(attacker, 0)).rejects.toThrow("not found");
    await expect(store.ensure(attacker)).rejects.toThrow("not found");
    await expect(store.latestCheckpoint(attacker)).rejects.toThrow("not found");
    expect((await store.read(owner, 0)).cursor).toBe(0);
  });
  it("fences old runners and preserves history when a new run starts", async () => {
    await store.saveEvents(owner, snapshot());
    const resumed = { ...owner, runId: "run-b" };
    await store.beginRun(resumed);
    await expect(store.saveEvents(owner, snapshot())).rejects.toThrow("Stale");
    await store.saveEvents(resumed, {
      status: "idle",
      sessionId: "session-a",
      events: [{ id: 3, type: "restored", data: {} }],
      cursor: 3,
    });
    expect((await store.read(resumed, 0)).events).toHaveLength(3);
  });
  it("does not replay a prompt whose outcome is uncertain after restoration", async () => {
    const command = {
      kind: "prompt" as const,
      requestId: crypto.randomUUID(),
      prompt: "Edit a file",
    };
    await store.reservePrompt(owner, command);
    await store.reservePrompt(owner, command);
    await expect(store.reservePrompt(owner, { ...command, prompt: "Different" })).rejects.toThrow(
      "another prompt",
    );
    const resumed = { ...owner, runId: "run-b" };
    await store.beginRun(resumed);
    await expect(store.reservePrompt(resumed, command)).rejects.toThrow("previous run");
  });
  it("keeps the last good checkpoint if a new checkpoint refers to unsaved events", async () => {
    await store.saveEvents(owner, snapshot());
    const checkpoint = {
      key: "tasks/task-a/checkpoint.tar.gz",
      metadata: {
        id: crypto.randomUUID(),
        sessionId: "session-a",
        cursor: 2,
        createdAt: Date.now(),
        size: 10,
        sha256: "a".repeat(64),
        interrupted: false,
      },
    };
    await store.saveCheckpoint(owner, checkpoint);
    await expect(
      store.saveCheckpoint(owner, {
        ...checkpoint,
        metadata: { ...checkpoint.metadata, id: crypto.randomUUID(), cursor: 9 },
      }),
    ).rejects.toThrow("not been saved");
    expect(await store.latestCheckpoint(owner)).toEqual(checkpoint);
    await expect(store.latestCheckpoint({ ...owner, userId: "user-b" })).rejects.toThrow(
      "not found",
    );
  });
  it("records interruption exactly once and does not lose earlier events", async () => {
    await store.saveEvents(owner, snapshot("running"));
    await store.finish(owner, true);
    await store.finish(owner, true);
    const history = await store.read(owner, 2);
    expect(history.events).toHaveLength(1);
    expect(history.events[0].type).toBe("interrupted");
    expect(history.status).toBe("interrupted");
  });
});

it("returns the latest permission mode even after its event cursor was consumed", async () => {
  const modes = {
    currentModeId: "agent",
    availableModes: [{ id: "read-only" }, { id: "agent" }],
  };
  await store.saveEvents(owner, {
    status: "idle",
    cursor: 1,
    head: 1,
    events: [{ id: 1, type: "permission_modes", data: modes }],
  });
  const recovered = await createSessionStore(db).read(owner, 1);
  expect(recovered.events).toEqual([]);
  expect(recovered.permissionModes).toEqual(modes);
});
