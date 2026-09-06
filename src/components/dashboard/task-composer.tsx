import { useRef, useState } from "react";
import { X } from "lucide-react";
import { DashboardIcon } from "./dashboard-icon";
import { RepositoryPicker } from "./repository-picker";
import { useNavigate } from "@tanstack/react-router";
import type { GitHubRepository } from "@/lib/github/functions";
import { createWorkspace } from "@/lib/workspaces/functions";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { WorkspaceList } from "./workspace-list";

interface Attachment {
  id: string;
  file: File;
}

export function TaskComposer() {
  const navigate = useNavigate();
  const [task, setTask] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [repository, setRepository] = useState<GitHubRepository | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<{ id: string; prompt: string; repositoryId: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaces = useWorkspaces();

  const start = async () => {
    if (!repository || !task.trim() || starting) return;
    if (attachments.length) {
      setError(
        "Remove attachments before preparing a workspace. File uploads are not supported yet.",
      );
      return;
    }
    setStarting(true);
    setError(null);
    if (request.current?.prompt !== task || request.current.repositoryId !== repository.id) {
      request.current = { id: crypto.randomUUID(), prompt: task, repositoryId: repository.id };
    }
    try {
      const created = await createWorkspace({
        data: { requestId: request.current.id, prompt: task, repository },
      });
      request.current = null;
      setTask("");
      await workspaces.refresh();
      await navigate({ to: "/app/tasks/$taskId", params: { taskId: created.id } });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create the workspace. Please try again.",
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="composer-wrapper">
      <div className="composer-intro">
        <h1>What would you like to build?</h1>
        <p>Describe the outcome and choose a repository to prepare your workspace.</p>
      </div>
      <form
        className="composer-surface"
        aria-label="Message composer"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <textarea
          aria-label="Describe the task"
          placeholder="e.g. Add keyboard shortcuts to the dashboard"
          value={task}
          disabled={starting}
          onChange={(e) => {
            setTask(e.target.value);
          }}
        />
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map(({ file, id }) => (
              <span key={id} className="attachment">
                {file.name}
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setAttachments((files) => files.filter((attachment) => attachment.id !== id))
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-toolbar">
          <div className="composer-options">
            <RepositoryPicker selected={repository} onSelect={setRepository} />
            <span className="workspace-note">OpenCode</span>
          </div>
          <div className="composer-actions">
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                setAttachments((files) => [
                  ...files,
                  ...Array.from(e.target.files ?? [], (file) => ({
                    id: crypto.randomUUID(),
                    file,
                  })),
                ]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="icon-button attach-button"
              aria-label="Attach file"
              onClick={() => fileInput.current?.click()}
            >
              <DashboardIcon name="attach" />
            </button>
            <button
              type="submit"
              className="send-button"
              aria-label={starting ? "Preparing workspace" : "Prepare workspace"}
              disabled={starting || !task.trim() || !repository || !workspaces.data?.configured}
              title="Prepare workspace"
            >
              <DashboardIcon name="send" size={18} />
            </button>
          </div>
        </div>
      </form>
      <p className="workspace-note">
        {workspaces.data?.configured === false
          ? "Workspace hosting is being set up. Repository browsing is still available."
          : "OpenCode runs your task in a private workspace for up to one hour."}
      </p>
      {(error || workspaces.error) && (
        <p className="workspace-error" role="alert">
          {error || workspaces.error}
        </p>
      )}
      <WorkspaceList workspaces={workspaces.data?.workspaces ?? []} onStop={workspaces.stop} />
    </div>
  );
}
