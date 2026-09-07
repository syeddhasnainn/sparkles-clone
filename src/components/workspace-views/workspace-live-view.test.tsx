// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceLiveView } from "./workspace-live-view";
import type { requestView } from "./view-client";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("shows a failed workspace connection without an indefinite preview spinner", async () => {
  const request = vi.fn<typeof requestView>().mockRejectedValue(new Error("Resume the workspace"));
  render(
    <WorkspaceLiveView
      taskId="task"
      service="preview"
      onStartPreview={async () => false}
      canStartPreview={false}
      agentWorking={false}
      request={request}
    />,
  );
  await screen.findByRole("heading", { name: "Preview unavailable" });
  expect(screen.queryByText("Starting preview…")).toBeNull();
  expect(screen.queryByRole("button", { name: "Stop preview" })).toBeNull();
});

async function setup(status: "stopped" | "failed", agentWorking = false) {
  const request = vi.fn<typeof requestView>();
  const start = vi.fn().mockResolvedValue(true);
  request.mockResolvedValue({
    kind: "services",
    preview: {
      status,
      command: "old setup command",
      port: 3000,
      managed: true,
      log: "Missing system tool",
    },
    desktop: { status: "stopped", log: "" },
  });
  render(
    <WorkspaceLiveView
      taskId="task"
      service="preview"
      onStartPreview={start}
      canStartPreview={!agentWorking}
      agentWorking={agentWorking}
      request={request}
    />,
  );
  await waitFor(() => expect(screen.getByText("Missing system tool")).toBeTruthy());
  return { request, start };
}

it("asks the agent to fix a failed preview instead of rerunning the failed command", async () => {
  const { start, request } = await setup("failed");
  fireEvent.click(screen.getByRole("button", { name: "Fix with agent" }));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(request.mock.calls.every(([, action]) => action.kind === "services")).toBe(true);
  expect(screen.getByText("Missing system tool")).toBeTruthy();
});

it("starts stopped previews through the agent and reports failed submissions", async () => {
  const { start, request } = await setup("stopped");
  start.mockResolvedValue(false);
  fireEvent.click(screen.getAllByRole("button", { name: "Start preview" })[0]);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Could not ask the agent"),
  );
  expect(request.mock.calls.every(([, action]) => action.kind === "services")).toBe(true);
});

it("does not submit another preview request while the agent is working", async () => {
  const { start } = await setup("failed", true);
  const button = screen.getByRole("button", { name: "Agent is working…" });
  expect(button).toHaveProperty("disabled", true);
  fireEvent.click(button);
  expect(start).not.toHaveBeenCalled();
});
