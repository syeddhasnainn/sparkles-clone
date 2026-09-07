import { z } from "zod";
import type { AgentSelection } from "../../../bridge/agent-selection";
import { permissionModesSchema } from "../../../bridge/permission-modes";
import {
  agentEventSchema,
  agentSnapshotSchema,
  agentStatusSchema,
  checkpointMetadataSchema,
} from "../../../bridge/contracts";
import type { AgentCommand, AgentSnapshot, CheckpointMetadata } from "../../../bridge/contracts";

export interface SessionOwner {
  selection?: AgentSelection;
  taskId: string;
  userId: string;
  runId: string;
}
export interface SavedCheckpoint {
  key: string;
  metadata: CheckpointMetadata;
}
export interface SessionStore {
  ensure(owner: SessionOwner): Promise<void>;
  beginRun(owner: SessionOwner): Promise<void>;
  read(owner: SessionOwner, cursor: number, options?: { all?: boolean }): Promise<AgentSnapshot>;
  saveEvents(owner: SessionOwner, snapshot: AgentSnapshot): Promise<number>;
  reservePrompt(
    owner: SessionOwner,
    command: Extract<AgentCommand, { kind: "prompt" }>,
  ): Promise<void>;
  finish(owner: SessionOwner, interrupted: boolean): Promise<void>;
  latestCheckpoint(owner: SessionOwner): Promise<SavedCheckpoint | null>;
  saveCheckpoint(owner: SessionOwner, checkpoint: SavedCheckpoint): Promise<void>;
  checkpoints(owner: SessionOwner): Promise<SavedCheckpoint[]>;
  deleteCheckpoint(owner: SessionOwner, id: string): Promise<void>;
}
const sessionRow = z.object({
  run_id: z.string(),
  session_id: z.string().nullable(),
  cursor: z.number(),
  status: agentStatusSchema,
});
const eventRow = z.object({ event_id: z.number(), type: z.string(), payload: z.string() });
const checkpointRow = z.object({ object_key: z.string(), metadata: z.string() });

export function createSessionStore(db: Pick<D1Database, "prepare" | "batch">): SessionStore {
  const readSession = async (owner: SessionOwner) => {
    const row = await db
      .prepare(
        "SELECT run_id, session_id, cursor, status FROM agent_sessions WHERE task_id = ? AND user_id = ?",
      )
      .bind(owner.taskId, owner.userId)
      .first();
    if (!row) throw new Error("Session not found.");
    return sessionRow.parse(row);
  };
  const checkpointRows = async (owner: SessionOwner) => {
    await readSession(owner);
    const rows = await db
      .prepare(
        "SELECT c.object_key, c.metadata FROM agent_checkpoints c JOIN agent_sessions s ON c.task_id = s.task_id WHERE c.task_id = ? AND s.user_id = ? ORDER BY c.created_at DESC, c.checkpoint_id DESC",
      )
      .bind(owner.taskId, owner.userId)
      .all();
    return rows.results.map((row) => {
      const parsed = checkpointRow.parse(row);
      return {
        key: parsed.object_key,
        metadata: checkpointMetadataSchema.parse(JSON.parse(parsed.metadata)),
      };
    });
  };
  return {
    async ensure(owner) {
      await db
        .prepare(
          "INSERT INTO agent_sessions(task_id, user_id, run_id, updated_at, selection) VALUES (?, ?, ?, ?, ?) ON CONFLICT(task_id) DO NOTHING",
        )
        .bind(
          owner.taskId,
          owner.userId,
          owner.runId,
          Date.now(),
          owner.selection ? JSON.stringify(owner.selection) : null,
        )
        .run();
      await readSession(owner);
    },
    async beginRun(owner) {
      await readSession(owner);
      await db
        .prepare(
          "UPDATE agent_sessions SET run_id = ?, status = 'starting', updated_at = ? WHERE task_id = ? AND user_id = ? AND run_id != ?",
        )
        .bind(owner.runId, Date.now(), owner.taskId, owner.userId, owner.runId)
        .run();
    },
    async read(owner, cursor, options) {
      const session = await readSession(owner);
      const rows = await db
        .prepare(
          `SELECT event_id, type, payload FROM agent_events WHERE task_id = ? AND event_id > ? AND event_id <= ? ORDER BY event_id${options?.all ? "" : " LIMIT 100"}`,
        )
        .bind(owner.taskId, cursor, session.cursor)
        .all();
      const events = rows.results.map((row) => {
        const parsed = eventRow.parse(row);
        return agentEventSchema.parse({
          id: parsed.event_id,
          type: parsed.type,
          data: JSON.parse(parsed.payload),
        });
      });
      const modeEvent = await db
        .prepare(
          "SELECT payload FROM agent_events WHERE task_id = ? AND type = 'permission_modes' ORDER BY event_id DESC LIMIT 1",
        )
        .bind(owner.taskId)
        .first();
      const modePayload = z.object({ payload: z.string() }).safeParse(modeEvent);
      return {
        permissionModes: modePayload.success
          ? permissionModesSchema.parse(JSON.parse(modePayload.data.payload))
          : undefined,
        status: session.status,
        sessionId: session.session_id,
        events,
        cursor: events.at(-1)?.id ?? Math.min(cursor, session.cursor),
        head: session.cursor,
      };
    },
    async saveEvents(owner, input) {
      const snapshot = agentSnapshotSchema.parse(input);
      const session = await readSession(owner);
      if (session.run_id !== owner.runId) throw new Error("Stale agent run.");
      let next = session.cursor;
      const statements: D1PreparedStatement[] = [];
      for (const event of snapshot.events) {
        if (event.id <= session.cursor) continue;
        if (event.id !== next + 1) throw new Error("Agent journal has a gap.");
        next = event.id;
        statements.push(
          db
            .prepare(
              "INSERT INTO agent_events(task_id, event_id, run_id, type, payload, created_at) SELECT task_id, ?, run_id, ?, ?, ? FROM agent_sessions WHERE task_id = ? AND user_id = ? AND run_id = ? ON CONFLICT(task_id, event_id) DO NOTHING",
            )
            .bind(
              event.id,
              event.type,
              JSON.stringify(event.data),
              Date.now(),
              owner.taskId,
              owner.userId,
              owner.runId,
            ),
        );
      }
      if (snapshot.cursor > next) throw new Error("Cannot acknowledge unsaved events.");
      statements.push(
        db
          .prepare(
            "UPDATE agent_sessions SET cursor = MAX(cursor, ?), session_id = COALESCE(?, session_id), status = CASE WHEN cursor <= ? THEN ? ELSE status END, updated_at = ? WHERE task_id = ? AND user_id = ? AND run_id = ?",
          )
          .bind(
            next,
            snapshot.sessionId ?? null,
            snapshot.cursor,
            snapshot.status,
            Date.now(),
            owner.taskId,
            owner.userId,
            owner.runId,
          ),
      );
      await db.batch(statements);
      const current = await readSession(owner);
      if (current.run_id !== owner.runId) throw new Error("Stale agent run.");
      return current.cursor;
    },
    async reservePrompt(owner, command) {
      const session = await readSession(owner);
      if (session.run_id !== owner.runId) throw new Error("Stale agent run.");
      await db
        .prepare(
          "INSERT INTO agent_commands(task_id, request_id, run_id, prompt, created_at) SELECT task_id, ?, run_id, ?, ? FROM agent_sessions WHERE task_id = ? AND user_id = ? AND run_id = ? ON CONFLICT(task_id, request_id) DO NOTHING",
        )
        .bind(
          command.requestId,
          command.prompt,
          Date.now(),
          owner.taskId,
          owner.userId,
          owner.runId,
        )
        .run();
      if ((await readSession(owner)).run_id !== owner.runId) throw new Error("Stale agent run.");
      const saved = z
        .object({ run_id: z.string(), prompt: z.string() })
        .parse(
          await db
            .prepare(
              "SELECT run_id, prompt FROM agent_commands WHERE task_id = ? AND request_id = ?",
            )
            .bind(owner.taskId, command.requestId)
            .first(),
        );
      if (saved.prompt !== command.prompt)
        throw new Error("This request ID was already used for another prompt.");
      if (saved.run_id !== owner.runId)
        throw new Error(
          "This request belongs to a previous run. Review the saved history before sending a new prompt.",
        );
    },
    async finish(owner, interrupted) {
      const status = interrupted ? "interrupted" : "stopped";
      const type = interrupted ? "interrupted" : "workspace_stopped";
      const payload = JSON.stringify({
        message: interrupted
          ? "The agent was interrupted. Review the saved checkpoint before continuing; unfinished tool operations will not be replayed automatically."
          : "Workspace stopped. Saved conversation history remains available.",
      });
      await db.batch([
        db
          .prepare(
            "INSERT INTO agent_events(task_id, event_id, run_id, type, payload, created_at) SELECT task_id, cursor + 1, run_id, ?, ?, ? FROM agent_sessions WHERE task_id = ? AND user_id = ? AND run_id = ? AND status NOT IN ('stopped', 'interrupted')",
          )
          .bind(type, payload, Date.now(), owner.taskId, owner.userId, owner.runId),
        db
          .prepare(
            "UPDATE agent_sessions SET cursor = cursor + 1, status = ?, updated_at = ? WHERE task_id = ? AND user_id = ? AND run_id = ? AND status NOT IN ('stopped', 'interrupted')",
          )
          .bind(status, Date.now(), owner.taskId, owner.userId, owner.runId),
      ]);
    },
    async latestCheckpoint(owner) {
      return (await checkpointRows(owner))[0] ?? null;
    },
    async saveCheckpoint(owner, checkpoint) {
      const session = await readSession(owner);
      if (session.run_id !== owner.runId) throw new Error("Stale checkpoint run.");
      if (checkpoint.metadata.cursor > session.cursor)
        throw new Error("Checkpoint events have not been saved.");
      await db
        .prepare(
          "INSERT INTO agent_checkpoints(task_id, checkpoint_id, run_id, object_key, metadata, created_at) SELECT task_id, ?, run_id, ?, ?, ? FROM agent_sessions WHERE task_id = ? AND user_id = ? AND run_id = ? AND cursor >= ? ON CONFLICT(task_id, checkpoint_id) DO NOTHING",
        )
        .bind(
          checkpoint.metadata.id,
          checkpoint.key,
          JSON.stringify(checkpoint.metadata),
          checkpoint.metadata.createdAt,
          owner.taskId,
          owner.userId,
          owner.runId,
          checkpoint.metadata.cursor,
        )
        .run();
      if ((await readSession(owner)).run_id !== owner.runId)
        throw new Error("Stale checkpoint run.");
    },
    checkpoints: checkpointRows,
    async deleteCheckpoint(owner, id) {
      await readSession(owner);
      await db
        .prepare("DELETE FROM agent_checkpoints WHERE task_id = ? AND checkpoint_id = ?")
        .bind(owner.taskId, id)
        .run();
    },
  };
}
