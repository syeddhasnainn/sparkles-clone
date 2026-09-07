import { agentName } from "../../../bridge/agent-selection";
import { useContext } from "react";
import { createPortal } from "react-dom";
import { TaskHeaderContext } from "../dashboard/dashboard-header";
import { useTaskAgent } from "@/hooks/use-task-agent";
import { useWorkspaces } from "@/hooks/use-workspaces";
import type { AgentSnapshot, Workspace } from "../../../bridge/contracts";
import { TaskSetup } from "./task-setup";
import { Conversation } from "./task-conversation";
import { Permissions } from "./task-permissions";
import { Followup } from "./task-followup";
import { TaskWorkbench } from "../workspace-views/task-workbench";

export function TaskPage({ taskId }: { taskId: string }) {
  const headerElement = useContext(TaskHeaderContext);
  const { data, error } = useWorkspaces();
  const workspace = data?.workspaces.find((item) => item.id === taskId);
  const agent = useTaskAgent(taskId, workspace?.status === "ready");
  const title = workspace?.prompt || "Loading task…";
  const titleCharacters = Array.from(title);
  const headerTitle =
    titleCharacters.length > 60 ? titleCharacters.slice(0, 59).join("").trimEnd() + "…" : title;
  return (
    <TaskWorkbench
      taskId={taskId}
      sandboxId={workspace?.sandboxId}
      ready={workspace?.status === "ready"}
    >
      <section className="task-page">
        {headerElement &&
          createPortal(
            <div className="task-chat-header">
              <h1 title={title}>{headerTitle}</h1>
              <span className="sr-only" role="status">
                {statusLabel(workspace, agent.snapshot)}
              </span>
            </div>,
            headerElement,
          )}
        <div className="task-scroll" tabIndex={0} aria-label="Task conversation">
          <div className="task-transcript">
            {(error || workspace?.error || agent.error) && (
              <p role="alert">{error || workspace?.error || agent.error}</p>
            )}
            <Conversation
              agentKind={workspace?.selection?.agent}
              events={agent.events}
              initialPrompt={workspace?.prompt}
              preparationLabel={
                workspace?.status === "provisioning"
                  ? workspace.restoring
                    ? "Restoring your workspace…"
                    : "Preparing your workspace…"
                  : workspace?.status === "ready" &&
                      workspace.phase !== "task" &&
                      agent.snapshot?.status !== "failed"
                    ? "Starting the agent…"
                    : undefined
              }
              streaming={
                agent.awaitingPrompt ||
                (workspace?.status === "ready" && agent.snapshot?.status === "running")
              }
            />
            {workspace?.status === "ready" && <Permissions agent={agent} />}
          </div>
        </div>
        <div className="task-composer-dock">
          <div className="task-composer-inner">
            {(workspace?.status !== "ready" || workspace.phase !== "task") && (
              <div className="composer-top-strip">
                <TaskSetup
                  workspace={workspace}
                  started={agent.events.some((event) => event.type === "user")}
                />
              </div>
            )}
            <Followup
              agent={agent}
              workspace={workspace}
              enabled={workspace?.status === "ready" && workspace.phase === "task"}
            />
          </div>
        </div>
      </section>
    </TaskWorkbench>
  );
}

function statusLabel(workspace: Workspace | undefined, snapshot: AgentSnapshot | null) {
  if (!workspace) return "Loading workspace…";
  if (workspace.status !== "ready")
    return workspace.status === "provisioning"
      ? workspace.restoring
        ? "Restoring your workspace…"
        : "Preparing your workspace…"
      : workspace.status;
  if (snapshot?.status === "running") return `${agentName(workspace.selection?.agent)} is working`;
  if (workspace.phase !== "task") return "Finishing workspace setup…";
  if (snapshot?.status === "idle") return `${agentName(workspace.selection?.agent)} is ready`;
  if (snapshot?.status === "checkpointing") return "Saving workspace…";
  if (snapshot?.status === "failed")
    return `${agentName(workspace.selection?.agent)} stopped unexpectedly`;
  return `Starting ${agentName(workspace.selection?.agent)}…`;
}
