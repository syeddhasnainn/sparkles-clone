import { Link } from "@tanstack/react-router";
import type { Workspace } from "../../../bridge/contracts";

interface WorkspaceListProps {
  workspaces: Workspace[];
  onStop: (id: string) => Promise<void>;
}

const labels = {
  provisioning: "Preparing repository…",
  ready: "OpenCode workspace",
  stopping: "Stopping…",
  stopped: "Stopped",
  failed: "Setup failed",
};

export function WorkspaceList({ workspaces, onStop }: WorkspaceListProps) {
  if (!workspaces.length) return null;

  return (
    <section className="workspace-list" aria-label="Your workspaces">
      <h2>Your workspaces</h2>
      {workspaces.map((workspace) => (
        <article className="workspace-card" key={workspace.id}>
          <div className="workspace-card-heading">
            <strong>{workspace.repository.name}</strong>
            <span className={`workspace-status workspace-status-${workspace.status}`}>
              {labels[workspace.status]}
            </span>
          </div>
          <p>
            <Link to="/app/tasks/$taskId" params={{ taskId: workspace.id }}>
              {workspace.prompt}
            </Link>
          </p>
          {workspace.status === "ready" && (
            <p className="workspace-detail">
              Repository checked out on sparkles/{workspace.id.slice(0, 8)}…
              {workspace.commit && ` · ${workspace.commit.slice(0, 7)}`}
              {" · Stops at "}
              {new Date(workspace.expiresAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
          {workspace.error && (
            <p className="workspace-detail" role="status">
              {workspace.error}
            </p>
          )}
          {["ready", "provisioning"].includes(workspace.status) && (
            <button
              className="workspace-stop"
              type="button"
              onClick={() => void onStop(workspace.id)}
            >
              Stop workspace
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
