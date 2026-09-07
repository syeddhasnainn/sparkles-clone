import { agentName } from "../../../bridge/agent-selection";
import { useRef } from "react";
import { useTaskAgent } from "@/hooks/use-task-agent";
import { useWorkspaces } from "@/hooks/use-workspaces";
import type { AgentSnapshot, Workspace } from "../../../bridge/contracts";
import { TaskSetup } from "./task-setup";
import { Conversation } from "./task-conversation";
import { Permissions } from "./task-permissions";
import { Followup } from "./task-followup";
import { TaskWorkbench } from "../workspace-views/task-workbench";
import { previewAgentPrompt } from "../workspace-views/preview-agent-prompt";

export function TaskPage({
  taskId,
  initialConversation,
}: {
  taskId: string;
  initialConversation?: AgentSnapshot;
}) {
  const { data, error, resume } = useWorkspaces();
  const workspace = data?.workspaces.find((item) => item.id === taskId);
  const agent = useTaskAgent(taskId, workspace?.status === "ready", initialConversation);
  const previewRequest = useRef<string | null>(null);
  const previewSubmitting = useRef(false);
  const canStartPreview =
    Boolean(workspace) &&
    !agent.sending &&
    !agent.awaitingPrompt &&
    (workspace?.status === "ready"
      ? workspace.phase === "task" && agent.snapshot?.status === "idle"
      : Boolean(workspace?.canResume));
  const startPreview = async () => {
    if (!canStartPreview || previewSubmitting.current) return false;
    previewSubmitting.current = true;
    previewRequest.current ??= crypto.randomUUID();
    try {
      const sent = await agent.send({
        kind: "prompt",
        requestId: previewRequest.current,
        prompt: previewAgentPrompt,
      });
      if (sent) previewRequest.current = null;
      return sent;
    } finally {
      previewSubmitting.current = false;
    }
  };
  return (
    <TaskWorkbench
      taskId={taskId}
      sandboxId={workspace?.sandboxId}
      ready={workspace?.status === "ready"}
      status={workspace?.status}
      canResume={Boolean(workspace?.canResume)}
      onStart={() => resume(taskId)}
      onStartPreview={startPreview}
      canStartPreview={canStartPreview}
      agentWorking={agent.sending || agent.awaitingPrompt || agent.snapshot?.status === "running"}
    >
      <section className="task-page">
        <span className="sr-only" role="status">
          {statusLabel(workspace, agent.snapshot)}
        </span>
        <div className="task-scroll" tabIndex={0} aria-label="Task conversation">
          <div className="task-transcript">
            {(error || workspace?.error || agent.error) && (
              <p role="alert">{error || workspace?.error || agent.error}</p>
            )}
            {workspace?.browserSessionError && (
              <p className="workspace-error" role="alert">
                {workspace.browserSessionError}
              </p>
            )}
            <Conversation
              agentKind={workspace?.selection?.agent}
              events={agent.events}
              initialPrompt={workspace?.prompt}
              preparationLabel={preparationLabel(workspace, agent.snapshot)}
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

function preparationLabel(workspace: Workspace | undefined, snapshot: AgentSnapshot | null) {
  if (workspace?.status === "provisioning")
    return workspace.restoring ? "Restoring your workspace…" : "Preparing your workspace…";
  if (workspace?.status === "ready" && workspace.phase !== "task" && snapshot?.status !== "failed")
    return "Starting the agent…";
  return undefined;
}
