import { expect, it, vi } from "vitest";
import { WorkspaceActivityStore } from "./activity";
import type { WorkspaceRecord } from "./controller";
import type { PullRequestSummary } from "../../../bridge/contracts";

const record: WorkspaceRecord = {
  id: "task-a",
  userId: "user-a",
  requestId: "request-a",
  prompt: "Change the sidebar",
  repository: { id: 42, installationId: 1, name: "owner/repo", defaultBranch: "main" },
  status: "ready",
  phase: "task",
  createdAt: 1,
  expiresAt: 2,
  sandboxId: "sandbox-a",
  commit: null,
  error: null,
  attempts: 0,
  retryAt: 0,
  terminalStatus: "stopped",
};
const pr: PullRequestSummary = { number: 22, state: "open", additions: 8, deletions: 31 };

function harness() {
  type Saved = Parameters<ConstructorParameters<typeof WorkspaceActivityStore>[0]["put"]>[1];
  const rows = new Map<string, Saved>();
  const storage = {
    get: async (key: string) => structuredClone(rows.get(key)),
    put: async (key: string, value: Saved) => {
      rows.set(key, structuredClone(value));
    },
  };
  let now = 100_000;
  const dependencies = {
    changes: vi.fn(async () => ({ additions: 5, deletions: 2 })),
    pullRequest: vi.fn<
      (
        _record: WorkspaceRecord,
        known?: PullRequestSummary | null,
      ) => Promise<PullRequestSummary | null>
    >(async () => null),
    now: () => now,
  };
  const store = new WorkspaceActivityStore(storage, dependencies);
  return {
    store,
    storage,
    dependencies,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

it("caches working changes without issuing a request on every sidebar poll", async () => {
  const { store, dependencies, advance } = harness();
  await store.refresh([record]);
  expect((await store.enrich([record]))[0].activity?.changes).toEqual({
    additions: 5,
    deletions: 2,
  });
  await store.refresh([record]);
  expect(dependencies.changes).toHaveBeenCalledTimes(1);
  advance(30_000);
  await store.refresh([record]);
  expect(dependencies.changes).toHaveBeenCalledTimes(2);
  expect(dependencies.pullRequest).toHaveBeenCalledTimes(1);
});

it("updates PR totals and merged status after a sandbox stops without waking it", async () => {
  const { store, storage, dependencies, advance } = harness();
  dependencies.pullRequest.mockResolvedValue(pr);
  await store.refresh([record]);
  advance(60_000);
  dependencies.pullRequest.mockResolvedValue({ ...pr, state: "merged" });
  const stopped: WorkspaceRecord = { ...record, status: "stopped" };
  await store.refresh([stopped]);
  expect(dependencies.changes).toHaveBeenCalledTimes(1);
  expect((await store.enrich([stopped]))[0].activity).toMatchObject({
    changes: { additions: 8, deletions: 31 },
    pullRequest: { number: 22, state: "merged" },
  });
  const restoredStore = new WorkspaceActivityStore(storage, dependencies);
  expect((await restoredStore.enrich([stopped]))[0].activity?.pullRequest?.state).toBe("merged");
});

it("preserves saved results on errors and retries after the polling interval", async () => {
  const { store, dependencies, advance } = harness();
  dependencies.pullRequest.mockResolvedValue(pr);
  await store.refresh([record]);
  advance(60_000);
  dependencies.pullRequest.mockRejectedValue(new Error("Unavailable"));
  dependencies.changes.mockRejectedValue(new Error("Unavailable"));
  await store.refresh([record]);
  expect((await store.enrich([record]))[0].activity?.pullRequest).toEqual(pr);
  await store.refresh([record]);
  expect(dependencies.pullRequest).toHaveBeenCalledTimes(2);
  advance(60_000);
  dependencies.pullRequest.mockResolvedValue({ ...pr, state: "closed" });
  await store.refresh([record]);
  expect((await store.enrich([record]))[0].activity?.pullRequest?.state).toBe("closed");
});

it("does not leak another task's cached activity", async () => {
  const { store } = harness();
  await store.refresh([record]);
  expect((await store.enrich([{ ...record, id: "other-task" }]))[0].activity).toBeUndefined();
});
