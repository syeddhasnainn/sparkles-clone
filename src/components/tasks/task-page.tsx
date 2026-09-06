import { useTaskAgent } from "@/hooks/use-task-agent";
import { useWorkspaces } from "@/hooks/use-workspaces";
import type { AgentSnapshot, Workspace } from "../../../bridge/contracts";
import { TaskSetup } from "./task-setup";
import { Conversation } from "./task-conversation";
import { Permissions } from "./task-permissions";
import { WorkspaceAction } from "./workspace-action";
import { Followup } from "./task-followup";

export function TaskPage({ taskId }: { taskId: string }) {
  const { data, error, stop, resume } = useWorkspaces();
  const workspace = data?.workspaces.find((item) => item.id === taskId);
  const agent = useTaskAgent(taskId, workspace?.status === "ready");
  return (
    <section className="task-page">
      <div className="task-scroll" tabIndex={0} aria-label="Task conversation">
        <div className="task-transcript">
          <header className="task-heading">
            <div>
              <p>{workspace?.repository.name || "Workspace"}</p>
              <h1>{workspace?.prompt || "Loading task…"}</h1>
            </div>
            <WorkspaceAction
              workspace={workspace}
              onStop={() => stop(taskId)}
              onResume={() => resume(taskId)}
            />
          </header>
          <p className="task-status" role="status">
            {statusLabel(workspace, agent.snapshot)}
          </p>
          <TaskSetup
            workspace={workspace}
            started={agent.events.some((event) => event.type === "user")}
          />
          {(error || workspace?.error || agent.error) && (
            <p role="alert">{error || workspace?.error || agent.error}</p>
          )}
          {workspace?.checkpointAt && (
            <p className="task-status">
              Workspace saved{" "}
              {new Date(workspace.checkpointAt).toISOString().replace("T", " ").slice(0, 19) +
                " UTC"}
            </p>
          )}
          <Conversation
            events={agent.events}
            streaming={workspace?.status === "ready" && agent.snapshot?.status === "running"}
          />
          {workspace?.status === "ready" && <Permissions agent={agent} />}
        </div>
      </div>
      <div className="task-composer-dock">
        <ComposerAvailability
          workspace={workspace}
          onStop={() => stop(taskId)}
          onResume={() => resume(taskId)}
        />
        <Followup
          agent={agent}
          workspace={workspace}
          enabled={workspace?.status === "ready" && workspace.phase === "task"}
        />
      </div>
    </section>
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
  if (workspace?.status === "ready") return null;
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
