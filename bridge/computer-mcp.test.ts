import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { computerMcpSource } from "./computer-mcp-source";

describe("computer MCP protocol", () => {
  it("advertises image and control tools without starting a desktop", () => {
    const messages = [
      { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { method: "notifications/initialized" },
      { id: 2, method: "tools/list" },
      {
        id: 3,
        method: "tools/call",
        params: { name: "computer_click", arguments: { x: -1, y: 2 } },
      },
      {
        id: 4,
        method: "tools/call",
        params: { name: "computer_type", arguments: { text: "blocked" } },
      },
      {
        id: 5,
        method: "tools/call",
        params: { name: "computer_open", arguments: { app: "browser", url: "file:///etc/passwd" } },
      },
      {
        id: 6,
        method: "tools/call",
        params: { name: "computer_key", arguments: { key: "Return; echo bad" } },
      },
    ];
    const result = spawnSync("python3", ["-c", computerMcpSource], {
      input:
        messages.map((message) => JSON.stringify({ jsonrpc: "2.0", ...message })).join("\n") + "\n",
      encoding: "utf8",
      env: { ...process.env, SPARKLES_STATE_DIR: "/nonexistent-sparkles-test-state" },
    });
    expect(result.status, result.stderr).toBe(0);
    const responses = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(responses).toHaveLength(6);
    expect(responses[0].result.protocolVersion).toBe("2025-06-18");
    expect(responses[1].result.tools).toHaveLength(6);
    expect(responses[1].result.tools[0].annotations.readOnlyHint).toBe(true);
    for (const response of responses.slice(2)) expect(response.result.isError).toBe(true);
    expect(responses[3].result.content[0].text).toContain("read-only");
  });
});
