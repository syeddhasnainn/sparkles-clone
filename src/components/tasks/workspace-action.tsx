import PlayIcon from "@hugeicons/core-free-icons/PlayIcon";
import { AppIcon } from "../ui/app-icon";
import type { Workspace } from "../../../bridge/contracts";

interface WorkspaceActionProps {
  workspace: Workspace | undefined;
  showIcon?: boolean;
  onStop: () => Promise<void>;
  onResume: () => Promise<void>;
}
export function WorkspaceAction({
  workspace,
  onStop,
  onResume,
  showIcon = true,
}: WorkspaceActionProps) {
  if (workspace && ["stopped", "failed"].includes(workspace.status)) {
    return (
      <button
        className="workspace-resume-button"
        type="button"
        disabled={!workspace.canResume}
        onClick={() => void onResume()}
      >
        {showIcon && <AppIcon icon={PlayIcon} size={14} />}
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
