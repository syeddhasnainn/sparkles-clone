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
    ["stopped", "failed"].includes(workspace.status)
  )
    return null;
  const stage = ["sandbox", "checkout", "agent", "task"].indexOf(workspace.phase || "sandbox");
  return (
    <ol className="task-setup" aria-label="Task setup">
      {[
        "Preparing sandbox",
        workspace.restoring ? "Restoring saved files" : "Checking repository",
        "Starting OpenCode",
        workspace.restoring ? "Restoring conversation" : "Starting task",
      ].map((label, index) => (
        <li
          key={label}
          data-state={index < stage ? "complete" : index === stage ? "active" : "pending"}
        >
          <span aria-hidden="true">{index < stage ? "✓" : index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
