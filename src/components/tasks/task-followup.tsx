import { useRef, useState } from "react";
import { ComposerPanel } from "../composer/composer-panel";
import type { Workspace } from "../../../bridge/contracts";
import type { Agent } from "./task-types";

export function Followup({
  agent,
  enabled,
  workspace,
}: {
  agent: Agent;
  enabled: boolean;
  workspace?: Workspace;
}) {
  const [prompt, setPrompt] = useState("");
  const submission = useRef<{ requestId: string; prompt: string } | null>(null);
  const canSend =
    Boolean(workspace) &&
    !agent.sending &&
    !agent.awaitingPrompt &&
    (enabled
      ? agent.snapshot?.status === "idle"
      : workspace?.status === "provisioning" ||
        workspace?.status === "stopping" ||
        workspace?.canResume);
  const submit = async () => {
    if (!canSend || !prompt.trim()) return;
    if (submission.current?.prompt !== prompt)
      submission.current = { requestId: crypto.randomUUID(), prompt };
    const submitted = submission.current;
    setPrompt("");
    if (await agent.send({ kind: "prompt", ...submitted })) {
      submission.current = null;
    } else {
      setPrompt((current) => current || submitted.prompt);
    }
  };
  return (
    <ComposerPanel
      selection={workspace?.selection}
      permissionModes={agent.snapshot?.permissionModes}
      onPermissionModeChange={(modeId) => agent.send({ kind: "set_permission_mode", modeId })}
      permissionModeDisabled={
        !enabled || !["idle", "running"].includes(agent.snapshot?.status ?? "")
      }
      permissionModeUnavailableReason={
        !enabled
          ? "Send a message to wake the workspace before changing permissions."
          : !agent.snapshot?.permissionModes
            ? "Permission controls are not available yet."
            : undefined
      }
      value={prompt}
      onChange={setPrompt}
      onSubmit={() => void submit()}
      label="Follow-up prompt"
      sendLabel="Send"
      sendDisabled={!canSend || !prompt.trim()}
      busy={agent.sending}
      running={enabled && agent.snapshot?.status === "running"}
      onStop={() => void agent.send({ kind: "cancel" })}
      branch={workspace?.repository.defaultBranch}
      repository={workspace?.repository.name.split("/").at(-1)}
    />
  );
}
