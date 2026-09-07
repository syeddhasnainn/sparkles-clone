// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkspaceService } from "./use-workspace-service";
import { isolatedWorkspaceUrl } from "./workspace-view-url";
import type { requestView as RequestView } from "./view-client";
import type { WorkspaceViewResult } from "../../../bridge/workspace-view-contracts";

const requestView = vi.fn<typeof RequestView>();
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function deferred() {
  let resolve!: (value: WorkspaceViewResult) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<WorkspaceViewResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const services: WorkspaceViewResult = {
  kind: "services",
  preview: { status: "stopped", command: "npm run dev", port: 3000, managed: true, log: "" },
  desktop: { status: "stopped", log: "" },
};

it("rejects parent-origin, non-Modal and non-HTTPS view URLs", () => {
  const origin = "https://app.example.com";
  expect(isolatedWorkspaceUrl("https://test.w.modal.host/__sparkles_connect#ticket", origin)).toBe(
    "https://test.w.modal.host/__sparkles_connect#ticket",
  );
  for (const url of [
    origin,
    "https://app.example.com/__sparkles_connect",
    "http://test.modal.run",
    "https://test.modal.run.evil.example",
    "https://test.modal.host.evil.example",
    "javascript:alert(1)",
    "https://user:password@test.modal.run",
  ]) {
    expect(() => isolatedWorkspaceUrl(url, origin)).toThrow();
  }
  expect(() => isolatedWorkspaceUrl("https://test.modal.run", "https://test.modal.run")).toThrow();
  expect(isolatedWorkspaceUrl("https://test.modal.run/__sparkles_connect#ticket", origin)).toBe(
    "https://test.modal.run/__sparkles_connect#ticket",
  );
});

it("ignores a previous task's delayed poll after switching tasks", async () => {
  const old = deferred();
  vi.mocked(requestView).mockImplementation((id) =>
    id === "old" ? old.promise : Promise.resolve(services),
  );
  const { result, rerender } = renderHook(
    ({ id }) => useWorkspaceService(id, "preview", "/", requestView),
    {
      initialProps: { id: "old" },
    },
  );
  rerender({ id: "new" });
  await waitFor(() => expect(result.current.services).toEqual(services));
  await act(async () => old.reject(new Error("stale failure")));
  expect(result.current.error).toBeNull();
});

it("ignores an old connection and releases pending state when actions fail", async () => {
  const old = deferred();
  vi.mocked(requestView).mockImplementation((_id, command) =>
    command.kind === "connect" ? old.promise : Promise.resolve(services),
  );
  const { result, rerender } = renderHook(
    ({ id }) => useWorkspaceService(id, "preview", "/", requestView),
    {
      initialProps: { id: "old" },
    },
  );
  await waitFor(() => expect(result.current.services).toEqual(services));
  let connecting!: Promise<void>;
  act(() => {
    connecting = result.current.connect();
  });
  rerender({ id: "new" });
  await act(async () => {
    old.resolve({
      kind: "connect",
      service: "preview",
      url: "https://old.modal.run/",
      expiresAt: Date.now() + 10000,
    });
    await connecting;
  });
  expect(result.current.connection).toBeNull();
  vi.mocked(requestView).mockRejectedValueOnce(new Error("failed action"));
  await act(async () => {
    await result.current.run({ kind: "preview-stop" });
  });
  expect(result.current.pending).toBe(false);
  expect(result.current.error).toBe("failed action");
});

it("only polls when opening preview, without starting the app or installing dependencies", async () => {
  requestView.mockResolvedValue(services);
  const { result, rerender } = renderHook(() =>
    useWorkspaceService("task", "preview", "/", requestView),
  );
  await waitFor(() => expect(result.current.status).toBe("stopped"));
  rerender();
  expect(requestView.mock.calls.every(([, action]) => action.kind === "services")).toBe(true);
});

it("clears a failed service poll after the workspace recovers", async () => {
  vi.useFakeTimers();
  try {
    requestView
      .mockRejectedValueOnce(new Error("Workspace unavailable"))
      .mockResolvedValue(services);
    const { result } = renderHook(() => useWorkspaceService("task", "preview", "/", requestView));
    await act(async () => {});
    expect(result.current.error).toBe("Workspace unavailable");
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(result.current.services).toEqual(services);
    expect(result.current.error).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("does not automatically retry failed previews or start the desktop", async () => {
  requestView.mockResolvedValue({
    ...services,
    preview: { ...services.preview, status: "failed" },
  });
  const { result, rerender } = renderHook(
    ({ service }: { service: "preview" | "desktop" }) =>
      useWorkspaceService("task", service, "/", requestView),
    { initialProps: { service: "preview" } },
  );
  await waitFor(() => expect(result.current.status).toBe("failed"));
  rerender({ service: "desktop" });
  await waitFor(() => expect(result.current.status).toBe("stopped"));
  expect(requestView.mock.calls.every(([, action]) => action.kind === "services")).toBe(true);
});

it("starts the desktop after an explicit sandbox-start request", async () => {
  const starting = { ...services, desktop: { ...services.desktop, status: "starting" as const } };
  requestView.mockImplementation((_id, action) =>
    Promise.resolve(action.kind === "desktop-start" ? starting : services),
  );
  const { result, rerender } = renderHook(() =>
    useWorkspaceService("task", "desktop", "/", requestView, true),
  );
  await waitFor(() => expect(result.current.status).toBe("starting"));
  rerender();
  expect(
    requestView.mock.calls.filter(([, action]) => action.kind === "desktop-start"),
  ).toHaveLength(1);
});
