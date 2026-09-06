import { z } from "zod";
import type { Events } from "./task-types";

export interface ToolCall {
  id: string;
  eventId: number;
  title: string;
  kind: string;
  status: string;
  paths: string[];
  input?: unknown;
  output?: unknown;
}
const updateSchema = z.object({
  toolCallId: z.string(),
  title: z.string().optional(),
  kind: z.string().optional(),
  status: z.string().optional(),
  locations: z.array(z.object({ path: z.string() })).optional(),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
  content: z.unknown().optional(),
});
export function toolCalls(events: Events): ToolCall[] {
  const calls = new Map<string, ToolCall>();
  let turn = 0;
  for (const event of events) {
    if (
      ["user", "complete", "error", "interrupted", "workspace_stopped", "restored"].includes(
        event.type,
      )
    ) {
      for (const call of calls.values()) {
        if (["pending", "in_progress"].includes(call.status)) call.status = "interrupted";
      }
      if (event.type === "user") turn = event.id;
    }
    if (
      event.type !== "update" ||
      !["tool_call", "tool_call_update"].includes(String(event.data.sessionUpdate))
    )
      continue;
    const parsed = updateSchema.safeParse(event.data);
    if (!parsed.success) continue;
    const update = parsed.data;
    const id = `${turn}:${update.toolCallId}`;
    const previous = calls.get(id);
    calls.set(id, {
      id,
      eventId: previous?.eventId ?? event.id,
      title: update.title ?? previous?.title ?? "Tool call",
      kind: update.kind ?? previous?.kind ?? "other",
      status: update.status ?? previous?.status ?? "pending",
      paths: update.locations?.map((location) => location.path) ?? previous?.paths ?? [],
      input: update.rawInput ?? previous?.input,
      output: update.rawOutput ?? update.content ?? previous?.output,
    });
  }
  return [...calls.values()];
}
