import type { Workspace } from "../../../bridge/contracts";

interface WorkspaceActionProps {
  workspace: Workspace | undefined;
  onStop: () => Promise<void>;
  onResume: () => Promise<void>;
}
export function WorkspaceAction({ workspace, onStop, onResume }: WorkspaceActionProps) {
  if (workspace && ["stopped", "failed"].includes(workspace.status)) {
    return (
      <button type="button" disabled={!workspace.canResume} onClick={() => void onResume()}>
        Resume workspace
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={!workspace || workspace.status === "stopping"}
      onClick={() => void onStop()}
    >
      {workspace?.status === "stopping" ? "Saving and stopping…" : "Stop workspace"}
    </button>
  );
}
