import { agentName } from "../../../bridge/agent-selection";
import type { Workspace } from "../../../bridge/contracts";

export function TaskSetup({
  workspace,
  started,
}: {
  workspace: Workspace | undefined;
  started: boolean;
}) {
  if (
    !workspace ||
    (started && !workspace.restoring) ||
    ["stopped", "failed", "stopping"].includes(workspace.status)
  )
    return null;
  const stage = ["sandbox", "checkout", "agent", "task"].indexOf(workspace.phase || "sandbox");
  const steps = [
    "Preparing sandbox",
    workspace.restoring ? "Restoring saved files" : "Checking repository",
    `Starting ${agentName(workspace.selection?.agent)}`,
    workspace.restoring ? "Restoring conversation" : "Starting task",
  ];
  return (
    <p className="task-setup-current" role="status">
      {workspace.status === "ready" && workspace.phase === "agent"
        ? "Finishing workspace setup"
        : steps[Math.max(0, stage)]}
      …
    </p>
  );
}
