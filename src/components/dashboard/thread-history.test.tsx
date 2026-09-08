// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Workspace } from "../../../bridge/contracts";
import { WorkspacesContext } from "../../hooks/use-workspaces";
import { ThreadHistory } from "./thread-history";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const workspaces: Workspace[] = Array.from({ length: 25 }, (_, index) => ({
  id: `thread-${index}`,
  prompt: `Task ${index}`,
  repository: { id: 1, installationId: 1, name: "owner/project", defaultBranch: "main" },
  status: index === 24 ? "failed" : "stopped",
  createdAt: Date.UTC(2026, 8, 8) - index * 1000,
  expiresAt: Date.UTC(2026, 8, 9),
  sandboxId: null,
  commit: null,
  error: null,
}));

async function renderHistory(threads = workspaces, error: string | null = null) {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const refresh = vi.fn(async () => {});
  const route = createRootRoute({
    component: () => (
      <WorkspacesContext
        value={{
          data: { configured: false, workspaces: threads },
          error,
          refresh,
          stop: async () => {},
          resume: async () => true,
        }}
      >
        <ThreadHistory />
      </WorkspacesContext>
    ),
  });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "History" });
  return refresh;
}

it("links every saved thread, including those beyond the sidebar limit and failed threads", async () => {
  await renderHistory();
  expect(screen.getAllByRole("link")).toHaveLength(25);
  expect(screen.getByRole("link", { name: /Task 24 / }).getAttribute("href")).toBe(
    "/app/tasks/thread-24",
  );
  expect(screen.getByText("Failed")).toBeTruthy();
});

it("searches titles and repositories without case sensitivity and handles no matches", async () => {
  await renderHistory();
  const search = screen.getByRole("searchbox", { name: "Search threads" });
  fireEvent.change(search, { target: { value: " TASK 24 " } });
  expect(screen.getAllByRole("link")).toHaveLength(1);
  fireEvent.change(search, { target: { value: "OWNER/PROJECT" } });
  expect(screen.getAllByRole("link")).toHaveLength(25);
  fireEvent.change(search, { target: { value: "missing" } });
  expect(screen.getByText("No threads match your search.")).toBeTruthy();
});

it("offers a new chat when history is empty", async () => {
  await renderHistory([]);
  expect(screen.getByRole("link", { name: "Start a new chat" }).getAttribute("href")).toBe("/app");
});

it("keeps saved threads visible after a refresh failure and allows retry", async () => {
  const refresh = await renderHistory(workspaces, "Could not load workspaces. Retrying shortly.");
  expect(screen.getAllByRole("link")).toHaveLength(25);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(refresh).toHaveBeenCalledOnce();
});
