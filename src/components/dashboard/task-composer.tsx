import { useRef, useState } from "react";
import { ComposerPanel } from "../composer/composer-panel";
import { RepositoryPicker } from "./repository-picker";
import { useNavigate } from "@tanstack/react-router";
import type { GitHubRepository } from "@/lib/github/functions";
import { createWorkspace } from "@/lib/workspaces/functions";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { WorkspaceList } from "./workspace-list";

export function TaskComposer() {
  const navigate = useNavigate();
  const [task, setTask] = useState("");
  const [repository, setRepository] = useState<GitHubRepository | null>(null);
  const request = useRef<{ id: string; prompt: string; repositoryId: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaces = useWorkspaces();

  const start = async () => {
    if (!repository || !task.trim() || starting) return;
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
      <ComposerPanel
        value={task}
        onChange={setTask}
        onSubmit={() => void start()}
        label="Describe the task"
        sendLabel={starting ? "Preparing workspace" : "Prepare workspace"}
        sendDisabled={starting || !task.trim() || !repository || !workspaces.data?.configured}
        busy={starting}
        branch={repository?.defaultBranch}
        repositoryPicker={<RepositoryPicker selected={repository} onSelect={setRepository} />}
      />
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
