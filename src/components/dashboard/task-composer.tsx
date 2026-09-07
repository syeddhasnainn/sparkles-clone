import { useChatGPTConnection } from "../../hooks/use-chatgpt-connection";
import { defaultAgentSelection } from "../../../bridge/agent-selection";
import type { AgentSelection } from "../../../bridge/agent-selection";
import { useRef, useState } from "react";
import { ComposerPanel } from "../composer/composer-panel";
import { RepositoryPicker } from "./repository-picker";
import { useNavigate } from "@tanstack/react-router";
import type { GitHubRepository } from "@/lib/github/functions";
import { createWorkspace } from "@/lib/workspaces/functions";
import { useWorkspaces } from "@/hooks/use-workspaces";

export function TaskComposer() {
  const navigate = useNavigate();
  const [selection, setSelection] = useState<AgentSelection>(defaultAgentSelection);
  const chatGPT = useChatGPTConnection();
  const connected = Boolean(
    chatGPT.connection?.account && !chatGPT.connection.account.reconnectRequired,
  );
  const [task, setTask] = useState("");
  const [repository, setRepository] = useState<GitHubRepository | null>(null);
  const request = useRef<{
    id: string;
    prompt: string;
    repositoryId: number;
    selection: string;
  } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaces = useWorkspaces();

  const start = async () => {
    if (!repository || !task.trim() || starting) return;
    setStarting(true);
    setError(null);
    if (
      request.current?.prompt !== task ||
      request.current.repositoryId !== repository.id ||
      request.current.selection !== JSON.stringify(selection)
    ) {
      request.current = {
        id: crypto.randomUUID(),
        prompt: task,
        repositoryId: repository.id,
        selection: JSON.stringify(selection),
      };
    }
    try {
      const created = await createWorkspace({
        data: { requestId: request.current.id, prompt: task, repository, selection },
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
        <img
          className="composer-mascots"
          src="/brand/sparkle-mascots-animated.svg"
          alt="Sparkles mascots"
          width={1628}
          height={421}
        />
      </div>
      <ComposerPanel
        selection={selection}
        onSelectionChange={setSelection}
        chatGPTConnected={connected}
        value={task}
        onChange={setTask}
        onSubmit={() => void start()}
        label="Describe the task"
        sendLabel={starting ? "Preparing workspace" : "Prepare workspace"}
        sendDisabled={
          starting ||
          !task.trim() ||
          !repository ||
          !workspaces.data?.configured ||
          (selection.provider === "chatgpt" && !connected)
        }
        busy={starting}
        branch={repository?.defaultBranch}
        repositoryPicker={<RepositoryPicker selected={repository} onSelect={setRepository} />}
      />
      {(error || workspaces.error) && (
        <p className="workspace-error" role="alert">
          {error || workspaces.error}
        </p>
      )}
    </div>
  );
}
