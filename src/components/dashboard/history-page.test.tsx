// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, expect, it } from "vitest";
import { HistoryPage } from "./history-page";
import { WorkspacesProvider } from "./workspaces-provider";
import type { Workspace } from "../../../bridge/contracts";

const workspaces: Workspace[] = Array.from({ length: 25 }, (_, index) => ({
  id: `task-${index}`,
  prompt: `Task ${index}`,
  repository: {
    id: 1,
    installationId: 1,
    name: "owner/repository",
    defaultBranch: "main",
  },
  status: index === 0 ? "failed" : "stopped",
  createdAt: 1700000000000 + index * 86400000,
  expiresAt: 1800000000000,
  sandboxId: null,
  commit: null,
  error: null,
}));

afterEach(cleanup);

async function renderHistory(items: Workspace[]) {
  const data = { configured: true, workspaces: items };
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/app/history",
    component: () => (
      <WorkspacesProvider
        initialData={data}
        client={{ list: async () => data, stop: async () => {}, resume: async () => {} }}
      >
        <HistoryPage />
      </WorkspacesProvider>
    ),
  });
  const task = createRoute({
    getParentRoute: () => root,
    path: "/app/tasks/$taskId",
    component: () => <p>Saved conversation</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([route, task]),
    history: createMemoryHistory({ initialEntries: ["/app/history"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "History" });
}

it("shows all saved tasks newest first and opens older failed conversations", async () => {
  await renderHistory(workspaces);
  const links = screen.getAllByRole("link");
  expect(links).toHaveLength(25);
  expect(links[0].textContent).toContain("Task 24");
  fireEvent.click(screen.getByRole("link", { name: /Task 0/ }));
  expect(await screen.findByText("Saved conversation")).toBeTruthy();
});

it("searches prompts and repositories and recovers from no matches", async () => {
  await renderHistory(workspaces);
  const search = screen.getByRole("searchbox", { name: "Search history" });
  fireEvent.change(search, { target: { value: " task 24 " } });
  expect(screen.getAllByRole("link")).toHaveLength(1);
  fireEvent.change(search, { target: { value: "OWNER/REPOSITORY" } });
  expect(screen.getAllByRole("link")).toHaveLength(25);
  fireEvent.change(search, { target: { value: "missing" } });
  expect(screen.getByText("No chats match your search.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getAllByRole("link")).toHaveLength(25);
});

it("offers a new chat when history is empty", async () => {
  await renderHistory([]);
  expect(screen.getByText("No chats yet.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Start a new chat" }).getAttribute("href")).toBe("/app");
});
