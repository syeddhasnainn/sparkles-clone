import { useContext } from "react";
import { createPortal } from "react-dom";
import { TaskHeaderContext } from "../dashboard/dashboard-header";
import { useTaskAgent } from "@/hooks/use-task-agent";
import { useWorkspaces } from "@/hooks/use-workspaces";
import type { AgentSnapshot, Workspace } from "../../../bridge/contracts";
import { TaskSetup } from "./task-setup";
import { Conversation } from "./task-conversation";
import { Permissions } from "./task-permissions";
import { WorkspaceAction } from "./workspace-action";
import { Followup } from "./task-followup";
import { TaskWorkbench } from "../workspace-views/task-workbench";

export function TaskPage({ taskId }: { taskId: string }) {
  const headerElement = useContext(TaskHeaderContext);
  const { data, error, stop, resume } = useWorkspaces();
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
              <WorkspaceAction
                workspace={workspace}
                onStop={() => stop(taskId)}
                onResume={() => resume(taskId)}
              />
            </div>,
            headerElement,
          )}
        <div className="task-scroll" tabIndex={0} aria-label="Task conversation">
          <div className="task-transcript">
            {(error || workspace?.error || agent.error) && (
              <p role="alert">{error || workspace?.error || agent.error}</p>
            )}
            <Conversation
              events={agent.events}
              streaming={workspace?.status === "ready" && agent.snapshot?.status === "running"}
            />
            {workspace?.status === "ready" && <Permissions agent={agent} />}
          </div>
        </div>
        <div className="task-composer-dock">
          <div className="task-composer-inner">
            {workspace?.status !== "ready" && (
              <div className="composer-top-strip">
                <ComposerAvailability
                  workspace={workspace}
                  onStop={() => stop(taskId)}
                  onResume={() => resume(taskId)}
                />
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
  if (snapshot?.status === "running") return "OpenCode is working";
  if (snapshot?.status === "idle") return "OpenCode is ready";
  if (snapshot?.status === "checkpointing") return "Saving workspace…";
  if (snapshot?.status === "failed") return "OpenCode stopped unexpectedly";
  return "Starting OpenCode…";
}

function ComposerAvailability({
  workspace,
  onStop,
  onResume,
}: {
  workspace?: Workspace;
  onStop: () => Promise<void>;
  onResume: () => Promise<void>;
}) {
  if (workspace?.status === "ready" || workspace?.status === "provisioning") return null;
  const stopped = workspace?.status === "stopped" || workspace?.status === "failed";
  let message = "You can draft a message while the workspace is getting ready.";
  if (stopped)
    message = workspace.canResume
      ? "You can draft a message. Resume the workspace to send it."
      : "You can draft a message, but this workspace cannot be resumed.";
  if (workspace?.status === "stopping")
    message = "Saving the workspace. You can keep drafting your message.";
  return (
    <div className="composer-availability">
      <span>{message}</span>
      {stopped && <WorkspaceAction workspace={workspace} onStop={onStop} onResume={onResume} />}
    </div>
  );
}
