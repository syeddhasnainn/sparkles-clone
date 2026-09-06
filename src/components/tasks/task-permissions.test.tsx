import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Permissions } from "./task-permissions";
import type { Agent } from "./task-types";

describe("permission request details", () => {
  it("preserves the requested operation when a later tool update changes its details", () => {
    const agent: Agent = {
      snapshot: null,
      error: null,
      sending: false,
      send: async () => true,
      events: [
        {
          id: 1,
          type: "permission",
          data: {
            id: "approval-a",
            toolCall: {
              toolCallId: "call-a",
              title: "Delete files",
              rawInput: { command: "rm -rf src" },
            },
            options: [{ optionId: "deny", name: "Reject" }],
          },
        },
        {
          id: 2,
          type: "update",
          data: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call-a",
            title: "Read files",
            rawInput: { command: "ls src" },
          },
        },
      ],
    };
    const markup = renderToStaticMarkup(<Permissions agent={agent} />);
    expect(markup).toContain("rm -rf src");
    expect(markup).toContain("Delete files");
    expect(markup).not.toContain("ls src");
    expect(markup).not.toContain("Read files");
  });
});
