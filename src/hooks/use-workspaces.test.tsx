// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspacesProvider } from "../components/dashboard/workspaces-provider";
import { useWorkspaces } from "./use-workspaces";
import type { WorkspaceClient } from "./use-workspaces";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

function Reader({ name }: { name: string }) {
  const { data } = useWorkspaces();
  return (
    <p>
      {name}: {data.configured ? "ready" : "unconfigured"}
    </p>
  );
}

it("shares loader data and one background poll between sidebar and task", async () => {
  vi.useFakeTimers();
  const client: WorkspaceClient = {
    list: vi.fn(async () => ({ configured: false, workspaces: [] })),
    stop: async () => {},
    resume: async () => {},
  };
  render(
    <WorkspacesProvider initialData={{ configured: true, workspaces: [] }} client={client}>
      <Reader name="Sidebar" />
      <Reader name="Task" />
    </WorkspacesProvider>,
  );
  expect(screen.getByText("Sidebar: ready")).toBeTruthy();
  expect(screen.getByText("Task: ready")).toBeTruthy();
  expect(client.list).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(client.list).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Sidebar: unconfigured")).toBeTruthy();
  expect(screen.getByText("Task: unconfigured")).toBeTruthy();
});
