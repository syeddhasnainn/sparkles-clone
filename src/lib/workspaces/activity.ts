import type { DiffSummary, PullRequestSummary, Workspace } from "../../../bridge/contracts";
import type { WorkspaceRecord } from "./controller";

interface SavedActivity {
  changes?: DiffSummary;
  pullRequest?: PullRequestSummary | null;
  changesCheckedAt?: number;
  pullRequestCheckedAt?: number;
}

interface ActivityStorage {
  get(key: string): Promise<SavedActivity | undefined>;
  put(key: string, value: SavedActivity): Promise<void>;
}

export class WorkspaceActivityStore {
  private refreshing = false;

  constructor(
    private readonly storage: ActivityStorage,
    private readonly dependencies: {
      changes: (record: WorkspaceRecord) => Promise<DiffSummary>;
      pullRequest: (
        record: WorkspaceRecord,
        known?: PullRequestSummary | null,
      ) => Promise<PullRequestSummary | null>;
      now?: () => number;
    },
  ) {}

  async enrich(workspaces: Workspace[]): Promise<Workspace[]> {
    return Promise.all(
      workspaces.map(async (workspace) => {
        const saved = await this.storage.get(`activity:${workspace.id}`);
        if (!saved) return workspace;
        return {
          ...workspace,
          activity: {
            changes: saved.pullRequest ?? saved.changes,
            pullRequest: saved.pullRequest ?? undefined,
          },
        };
      }),
    );
  }

  async refresh(records: WorkspaceRecord[]) {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const recent = records.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
      for (let start = 0; start < recent.length; start += 4) {
        await Promise.all(
          recent.slice(start, start + 4).map((record) => this.refreshRecord(record)),
        );
      }
    } finally {
      this.refreshing = false;
    }
  }

  private async refreshRecord(record: WorkspaceRecord) {
    const key = `activity:${record.id}`;
    const saved = (await this.storage.get(key)) ?? {};
    const now = this.dependencies.now?.() ?? Date.now();
    const running = record.status === "ready" && record.phase === "task";
    let changed = false;

    if (running && (!saved.changesCheckedAt || now - saved.changesCheckedAt >= 30_000)) {
      saved.changesCheckedAt = now;
      changed = true;
      try {
        saved.changes = await this.dependencies.changes(record);
      } catch {
        // Retain the last successful snapshot when the workspace is unavailable.
      }
    }

    const interval = running || saved.pullRequest ? 60_000 : 300_000;
    if (!saved.pullRequestCheckedAt || now - saved.pullRequestCheckedAt >= interval) {
      saved.pullRequestCheckedAt = now;
      changed = true;
      try {
        saved.pullRequest = await this.dependencies.pullRequest(record, saved.pullRequest);
      } catch {
        // A GitHub outage or expired connection must not erase the saved PR status.
      }
    }

    if (changed) await this.storage.put(key, saved);
  }
}
