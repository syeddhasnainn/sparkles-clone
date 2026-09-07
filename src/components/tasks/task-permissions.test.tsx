// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Permissions } from "./task-permissions";
import type { Agent } from "./task-types";

describe("permission request details", () => {
  it("preserves the requested operation when a later tool update changes its details", () => {
    const agent: Agent = {
      snapshot: null,
      error: null,
      sending: false,
      awaitingPrompt: false,
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

afterEach(cleanup);

const request = (id: number): Agent["events"][number] => ({
  id,
  type: "permission",
  data: {
    id: `approval-${id}`,
    toolCall: { title: `Run command ${id}`, rawInput: { command: "pwd" } },
    options: [
      { optionId: "allow-once", name: "Allow once" },
      { optionId: "reject", name: "Reject" },
    ],
  },
});

it("requires explicit submission and sends the original approval and option IDs", async () => {
  const send = vi.fn(async () => true);
  render(
    <Permissions
      agent={{
        events: [request(1)],
        snapshot: null,
        sending: false,
        awaitingPrompt: false,
        error: null,
        send,
      }}
    />,
  );
  expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({
      kind: "permission",
      id: "approval-1",
      optionId: "allow-once",
    }),
  );
});

it("shows one approval at a time and Skip does not grant or reject it", () => {
  const send = vi.fn(async () => true);
  render(
    <Permissions
      agent={{
        events: [request(1), request(2)],
        snapshot: null,
        sending: false,
        awaitingPrompt: false,
        error: null,
        send,
      }}
    />,
  );
  expect(screen.queryByText("Run command 2")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next approval" }));
  expect(screen.getByText("Run command 2")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  fireEvent.click(screen.getByRole("button", { name: "Review approvals (2)" }));
  expect(screen.getByText("Run command 2")).toBeTruthy();
  expect(send).not.toHaveBeenCalled();
});

it("keeps a failed approval available for retry", async () => {
  const send = vi.fn(async () => false);
  render(
    <Permissions
      agent={{
        events: [request(1)],
        snapshot: null,
        sending: false,
        awaitingPrompt: false,
        error: null,
        send,
      }}
    />,
  );
  fireEvent.click(screen.getByRole("radio", { name: "Reject" }));
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false);
});
