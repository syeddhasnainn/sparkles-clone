import { describe, expect, it } from "vitest";
import { toolCalls } from "./tool-activity";
import type { Events } from "./task-types";

const updates: Events = [
  { id: 1, type: "user", data: { text: "Read a file" } },
  {
    id: 2,
    type: "update",
    data: {
      sessionUpdate: "tool_call",
      toolCallId: "read-1",
      title: "read",
      kind: "read",
      status: "pending",
    },
  },
  {
    id: 3,
    type: "update",
    data: {
      sessionUpdate: "tool_call_update",
      toolCallId: "read-1",
      status: "in_progress",
      locations: [{ path: "/workspace/repo/app.tsx" }],
      rawInput: { filePath: "/workspace/repo/app.tsx" },
    },
  },
  {
    id: 4,
    type: "update",
    data: {
      sessionUpdate: "tool_call_update",
      toolCallId: "read-1",
      status: "completed",
      title: "app.tsx",
      rawOutput: { output: "file contents" },
    },
  },
];
describe("tool activity", () => {
  it("merges incremental updates into one call while preserving input and file locations", () => {
    const calls = toolCalls(updates);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      eventId: 2,
      title: "app.tsx",
      kind: "read",
      status: "completed",
      paths: ["/workspace/repo/app.tsx"],
      input: { filePath: "/workspace/repo/app.tsx" },
      output: { output: "file contents" },
    });
  });
  it("settles unfinished calls when a turn is interrupted", () => {
    expect(
      toolCalls([...updates.slice(0, 3), { id: 4, type: "interrupted", data: {} }])[0].status,
    ).toBe("interrupted");
  });
  it("keeps reused tool IDs in later turns separate", () => {
    const calls = toolCalls([
      ...updates,
      { id: 5, type: "user", data: {} },
      { ...updates[1], id: 6 },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].status).toBe("completed");
    expect(calls[1].status).toBe("pending");
    expect(calls[0].id).not.toBe(calls[1].id);
  });
});
